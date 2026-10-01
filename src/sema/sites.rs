//! The places in a file whose types are compared against TypeScript's, each with a position that another tool can find too.

use crate::atom::{Atom, known};
use crate::bind::{Bound, Decl, FnOwner, MemberOwner, Parent, PatParent, SymFlags};
use crate::check::Checker;
use crate::hir::*;
use crate::program::FileId;
use crate::types::TypeId;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, PartialOrd, Ord)]
pub enum SiteKind {
    /// `o` in `o.p`, at the name.
    PropBase,
    /// `o.p`, at the name.
    PropResult,
    /// `o` in `o[k]`, at the key.
    ElemBase,
    ElemResult,
    /// `f` in `f(x)`, at the `)`.
    Callee,
    CallResult,
    /// At `new`.
    NewResult,
    /// At `await`.
    Await,
    /// At the name.
    Param,
    Var,
    /// At the `(` of the parameters, or the `=>`.
    FnReturn,
}

impl SiteKind {
    pub const ALL: [SiteKind; 11] = [
        SiteKind::PropBase,
        SiteKind::PropResult,
        SiteKind::ElemBase,
        SiteKind::ElemResult,
        SiteKind::Callee,
        SiteKind::CallResult,
        SiteKind::NewResult,
        SiteKind::Await,
        SiteKind::Param,
        SiteKind::Var,
        SiteKind::FnReturn,
    ];

    pub fn code(self) -> &'static str {
        match self {
            SiteKind::PropBase => "pb",
            SiteKind::PropResult => "pr",
            SiteKind::ElemBase => "eb",
            SiteKind::ElemResult => "er",
            SiteKind::Callee => "cf",
            SiteKind::CallResult => "cr",
            SiteKind::NewResult => "nr",
            SiteKind::Await => "aw",
            SiteKind::Param => "pa",
            SiteKind::Var => "va",
            SiteKind::FnReturn => "fr",
        }
    }

    pub fn from_code(code: &str) -> Option<SiteKind> {
        SiteKind::ALL.into_iter().find(|k| k.code() == code)
    }
}

/// Where `e` starts as it is written, not counting parentheses around the whole of it.
fn start_inside_parentheses(hir: &File, mut e: ExprId) -> u32 {
    let mut whole = true;
    loop {
        if !std::mem::take(&mut whole)
            && let Ok(at) = hir.parens.binary_search_by_key(&e.0, |p| p.0.0)
        {
            return hir.parens[at].1;
        }
        // It starts where what it starts with starts.
        e = match hir[e].kind {
            ExprKind::Binary { left, .. } => left,
            ExprKind::Assign { target, .. } => target,
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
            ExprKind::Call(c) | ExprKind::TaggedTemplate(c) => hir[c].callee,
            ExprKind::Cond { test, .. } => test,
            ExprKind::NonNull(x) | ExprKind::AsConst(x) => x,
            ExprKind::Satisfies { expr, .. } | ExprKind::Instantiation { expr, .. } => expr,
            // `x as T`, not `<T>x`.
            ExprKind::As { expr, ty } if hir[ty].pos > hir[expr].pos => expr,
            ExprKind::Unary {
                op: UnOp::PostInc | UnOp::PostDec,
                operand,
            } => operand,
            _ => return hir[e].pos,
        };
    }
}

/// The declaration of a variable that the name `pat` is part of.
fn var_decl_of(bound: &Bound, mut pat: PatId) -> Option<VarDeclId> {
    loop {
        match bound.pat_parent[pat.idx()] {
            PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => pat = outer,
            PatParent::Var(d) => return Some(d),
            PatParent::Param(_) | PatParent::None => return None,
        }
    }
}

/// The first value among `decls`, the declarations of one name in the order they are bound, if it is a `var` or a parameter: the
/// `var`s of the name are one symbol with it (`FunctionScopedVariableExcludes`). After any other value `declareSymbolEx` gives each
/// `var` a symbol of its own. `declareModuleMember`: what is exported and what is not are two symbols; `exported` says which is meant.
fn first_variable(
    c: &Checker<'_>,
    decls: impl Iterator<Item = (FileId, Decl)>,
    exported: bool,
) -> Option<(FileId, PatId)> {
    for (file, decl) in decls {
        let (hir, bound) = (c.hir(file), c.bound(file));
        let (flags, variable) = match decl {
            Decl::Param(pat) => return Some((file, pat)),
            Decl::Var(pat) => {
                let d = var_decl_of(bound, pat)?;
                (
                    hir[d].flags,
                    (hir[d].kind == VarKind::Var).then_some((file, pat)),
                )
            }
            Decl::Fn(f) => (hir[f].flags, None),
            Decl::Class(k) => (hir[k].flags, None),
            Decl::Enum(e) => (hir[e].flags, None),
            Decl::Module(m) if bound.module_instantiated[m.idx()] => (hir[m].flags, None),
            // Types and aliases do not stand in the way.
            _ => continue,
        };
        if flags.contains(Flags::EXPORT) == exported {
            return variable;
        }
    }
    None
}

/// `symbol.ValueDeclaration` of the symbol the name `pat` declares, which is what `getTypeOfSymbol` goes by.
fn value_declaration(c: &Checker<'_>, file: FileId, pat: PatId) -> (FileId, PatId) {
    let own = (file, pat);
    let bound = c.bound(file);
    let local = bound.pat_symbol[pat.idx()];
    let Some(d) = var_decl_of(bound, pat) else {
        return own;
    };
    let decl = &c.hir(file)[d];
    if local.is_none() || decl.kind != VarKind::Var {
        return own;
    }
    let symbol = &bound.symbols[local.idx()];
    let is_merged = symbol.flags.contains(SymFlags::MERGED);
    if symbol.decls.len() < 2 && !is_merged {
        return own;
    }
    let exported = decl.flags.contains(Flags::EXPORT);
    let Some(here) = first_variable(c, symbol.decls.iter().map(|&decl| (file, decl)), exported)
    else {
        return own;
    };
    if !is_merged {
        return here;
    }
    // `mergeSymbol`: what the files have under one global name is one symbol on the same condition, the files in their order.
    let sym = c.p.files.sym(file, local);
    first_variable(c, c.p.files.decls(sym).into_iter(), exported).unwrap_or(here)
}

/// The name of the parameter property `p` stands for the property, which `bindParameter` declares last. `PropertyExcludes`: that is
/// one symbol with the properties and the accessors of the name in the class, unless a method has the name. `getTypeOfSymbol`: an
/// accessor says what the symbol is, else its first declaration. `None`: that is `p`.
fn type_of_parameter_property(
    c: &mut Checker<'_>,
    file: FileId,
    p: ParamId,
    name: Atom,
) -> Option<TypeId> {
    let (hir, bound) = (c.hir(file), c.bound(file));
    let FnOwner::Member(constructor) = bound.fns[bound.param_fn[p.idx()].idx()].owner else {
        return None;
    };
    let MemberOwner::Class(class) = bound.member_owner[constructor.idx()] else {
        return None;
    };
    // The first declaration: the name of a parameter, `NONE` for a member.
    let mut first = None;
    let mut has_accessor = false;
    for m in hir[class].members.iter() {
        let member = &hir[m];
        match member.kind {
            MemberKind::Constructor => {
                let declares = |q: &ParamId| {
                    hir[*q].flags.contains(Flags::PARAMETER_PROPERTY)
                        && matches!(hir[hir[*q].pat].kind, PatKind::Ident(n) if n == name)
                };
                if let Some(q) = hir[member.func].params.iter().find(declares) {
                    first.get_or_insert(hir[q].pat);
                }
            }
            _ if member.flags.contains(Flags::STATIC) || member.key.name() != Some(name) => {}
            MemberKind::Method if first.is_none() => return None,
            MemberKind::Property => {
                first.get_or_insert(PatId::NONE);
            }
            MemberKind::Getter | MemberKind::Setter => {
                has_accessor = true;
                first.get_or_insert(PatId::NONE);
            }
            _ => {}
        }
    }
    let first = first?;
    if has_accessor || first.is_none() {
        let class = c.p.files.sym(file, bound.class_symbol[class.idx()]);
        let instance = c.declared_type(class);
        return c.type_of_property(instance, name);
    }
    (first != hir[p].pat).then(|| c.type_of_pat(file, first))
}

/// `node.body != nil`: a body is written, or its `{` is missing and the parser made a zero-width block.
fn has_body_node(func: &Func) -> bool {
    !matches!(func.body, FnBody::None) || func.flags.contains(Flags::MISSING_BODY)
}

/// Calls `emit` with every site of `file` and its type.
pub fn for_each_site(
    c: &mut Checker<'_>,
    file: FileId,
    mut emit: impl FnMut(&mut Checker<'_>, u32, SiteKind, TypeId),
) {
    let hir = c.hir(file);
    // `getTypeOfNode`: nothing is said of what is in the statement of a `with`.
    let type_at = |c: &mut Checker<'_>, e: ExprId| {
        if hir.is_in_with(hir[e].pos) {
            TypeId::ANY
        } else {
            c.type_at(file, e)
        }
    };
    for i in 0..hir.exprs.len() {
        let e = ExprId(i as u32);
        // What was made up for a declaration file or never attached to anything is not a site.
        if matches!(c.bound(file).expr_parent[i], Parent::None) {
            continue;
        }
        match hir[e].kind {
            ExprKind::Dot { obj, name_pos, .. } => {
                let ty = type_at(c, obj);
                emit(c, name_pos, SiteKind::PropBase, ty);
                if !c.is_assignment_target(file, e) {
                    let ty = type_at(c, e);
                    emit(c, name_pos, SiteKind::PropResult, ty);
                }
            }
            ExprKind::Index { obj, index, .. } => {
                let at = start_inside_parentheses(hir, index);
                let ty = type_at(c, obj);
                emit(c, at, SiteKind::ElemBase, ty);
                if !c.is_assignment_target(file, e) {
                    let ty = type_at(c, e);
                    emit(c, at, SiteKind::ElemResult, ty);
                }
            }
            ExprKind::Call(call) => {
                let call = &hir[call];
                if matches!(hir[call.callee].kind, ExprKind::Super) || call.close_pos == u32::MAX {
                    continue;
                }
                let ty = type_at(c, call.callee);
                emit(c, call.close_pos, SiteKind::Callee, ty);
                let ty = type_at(c, e);
                emit(c, call.close_pos, SiteKind::CallResult, ty);
            }
            // The callee of `import.defer(..)` is a meta property, of the error type (`checkMetaProperty`). `import(..)` is no site.
            ExprKind::ImportCall(specifier) => {
                let Some(&(_, close_pos)) =
                    hir.deferred_import_calls.iter().find(|d| d.0 == specifier)
                else {
                    continue;
                };
                emit(c, close_pos, SiteKind::Callee, TypeId::ANY);
                let ty = type_at(c, e);
                emit(c, close_pos, SiteKind::CallResult, ty);
            }
            ExprKind::New(_) => {
                let ty = type_at(c, e);
                emit(c, hir[e].pos, SiteKind::NewResult, ty);
            }
            ExprKind::Await(_) => {
                let ty = type_at(c, e);
                emit(c, hir[e].pos, SiteKind::Await, ty);
            }
            _ => {}
        }
    }
    for i in 0..hir.pats.len() {
        let pat = PatId(i as u32);
        let PatKind::Ident(name) = hir[pat].kind else {
            continue;
        };
        let parent = c.bound(file).pat_parent[i];
        // The declaration the pattern belongs to.
        let mut root = parent;
        while let PatParent::Prop(outer, _) | PatParent::Elem(outer, _) = root {
            root = c.bound(file).pat_parent[outer.idx()];
        }
        let kind = match (parent, root) {
            // A `this` that is not the first parameter is listed with the others. No site is asked for a parameter of that name.
            (PatParent::Param(_), _) if name == known::this => continue,
            (PatParent::Param(_), _) => SiteKind::Param,
            (PatParent::None, _) | (_, PatParent::None) => continue,
            _ => SiteKind::Var,
        };
        match root {
            PatParent::Param(p) => {
                let func = c.bound(file).param_fn[p.idx()];
                if !has_body_node(&hir[func]) {
                    continue;
                }
                c.prepare_fn(file, func);
            }
            PatParent::Var(d) => {
                let stmt = c.bound(file).var_stmt[d.idx()];
                if stmt.is_some() {
                    c.prepare_parent(file, Parent::Stmt(stmt));
                }
            }
            _ => {}
        }
        // `getTypeOfNode` of the name of a declaration: the type of its symbol.
        let ty = if hir.is_in_with(hir[pat].pos) {
            TypeId::ANY
        } else if let PatParent::Param(p) = parent
            && hir[p].flags.contains(Flags::PARAMETER_PROPERTY)
            && let Some(ty) = type_of_parameter_property(c, file, p, name)
        {
            ty
        } else if let Some(exported) = c.p.files.required_module_exports(file, pat) {
            // `getTypeOfAlias`: the name is an alias of the `"module.exports"` export, the `require` call is still the module.
            c.type_of_symbol(exported)
        } else {
            match value_declaration(c, file, pat) {
                // `getTypeOfVariableOrParameterOrProperty` hands the first to ask what it worked out, whatever it kept.
                first if first == (file, pat) => c.type_of_pat_as_first_asked(file, pat),
                (of, first) => c.type_of_pat(of, first),
            }
        };
        emit(c, hir[pat].pos, kind, ty);
    }
    for i in 0..hir.fns.len() {
        let func = FnId(i as u32);
        let f = &hir[func];
        if !has_body_node(f)
            || matches!(
                f.kind,
                FnKind::Constructor | FnKind::Setter | FnKind::StaticBlock
            )
        {
            continue;
        }
        if matches!(c.bound(file).fns[i].owner, FnOwner::None) {
            continue;
        }
        c.prepare_fn(file, func);
        let ty = c.return_type_of_fn(file, func);
        emit(c, f.anchor, SiteKind::FnReturn, ty);
    }
}
