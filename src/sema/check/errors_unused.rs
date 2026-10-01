//! What is declared and never used: 6133 6138 6192 6196 6198 6199 6205, under `noUnusedLocals` and `noUnusedParameters`.
//!
//! Follows `checkUnusedIdentifiers` and what it calls in TypeScript 7.0.2's checker.go. They note what is referred to while
//! checking; here a file is gone through once for that.

use super::errors::Diagnostic;
use super::*;
use crate::bind::{
    Bound, ClassOwner, Decl, FnOwner, MemberOwner, Parent, PatParent, ScopeId, ScopeKind, SymbolId,
};

/// The meanings a name was looked up with.
const VALUE: u8 = 1;
const TYPE: u8 = 2;
const NAMESPACE: u8 = 4;
const ALL: u8 = 7;

struct Unused<'a> {
    hir: &'a hir::File,
    bound: &'a Bound,
    atoms: &'a crate::atom::Interner,
    /// By symbol: the meanings it was referred to with.
    referenced: Vec<u8>,
    /// The members of classes that are private and read somewhere.
    read_members: Vec<MemberId>,
    read_parameter_properties: Vec<ParamId>,
    /// Something was read under a key that could not be worked out: it may have been any member.
    reads_unknown_members: bool,
    /// By scope: the function, class, interface, enum, alias or namespace declared whose scope it is.
    owner_of_scope: Vec<SymbolId>,
    stmt_of_module: Vec<StmtId>,
    stmt_of_enum: Vec<StmtId>,
    stmt_of_import: Vec<StmtId>,
    /// The scopes of ambient type aliases, and of the signatures and `infer` type parameters in the types of ambient variables and
    /// properties. Sorted. Filled only under `noUnusedParameters`.
    ambient_type_scopes: Vec<ScopeId>,
    /// The file has a `return` whose expression is never checked: see `is_in_unchecked_return`.
    has_unchecked_returns: bool,
    /// The starts of the parser's and the scanner's errors. Sorted. Empty for a file that parses.
    syntax_errors: Vec<u32>,
    locals: bool,
    parameters: bool,
}

/// What an expression can be written in.
#[derive(Copy, Clone)]
enum Around {
    Fn(FnId),
    Class(ClassId),
    Enum(EnumId),
    Module(ModuleId),
    Return(StmtId),
}

impl Checker<'_> {
    pub(super) fn check_unused(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let options = &self.p.files.options;
        let (locals, parameters) = (options.no_unused_locals, options.no_unused_parameters);
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !(locals || parameters) || hir.kind == FileKind::Declaration {
            return;
        }
        let mut syntax_errors: Vec<u32> = if hir.has_parse_diagnostics {
            let is_syntactic = |code: u32| {
                super::errors_js::SYNTACTIC_ERRORS
                    .binary_search(&code)
                    .is_ok()
            };
            hir.early_errors
                .iter()
                .filter(|error| is_syntactic(error.1))
                .map(|error| error.0)
                .collect()
        } else {
            Vec::new()
        };
        syntax_errors.sort_unstable();
        let mut u = Unused {
            hir,
            bound,
            atoms: &self.p.files.atoms,
            referenced: vec![0; bound.symbols.len()],
            read_members: Vec::new(),
            read_parameter_properties: Vec::new(),
            reads_unknown_members: false,
            owner_of_scope: vec![SymbolId::NONE; bound.scopes.len()],
            stmt_of_module: vec![StmtId::NONE; hir.modules.len()],
            stmt_of_enum: vec![StmtId::NONE; hir.enums.len()],
            stmt_of_import: vec![StmtId::NONE; hir.imports.len()],
            ambient_type_scopes: Vec::new(),
            has_unchecked_returns: false,
            syntax_errors,
            locals,
            parameters,
        };
        for (i, s) in hir.stmts.iter().enumerate() {
            match s.kind {
                StmtKind::Module(m) => u.stmt_of_module[m.idx()] = StmtId(i as u32),
                StmtKind::Enum(e) => u.stmt_of_enum[e.idx()] = StmtId(i as u32),
                StmtKind::Import(id) => u.stmt_of_import[id.idx()] = StmtId(i as u32),
                _ => {}
            }
        }
        for (i, s) in bound.scopes.iter().enumerate() {
            u.owner_of_scope[i] = match s.kind {
                ScopeKind::Fn(f) if hir[f].kind == FnKind::Decl => bound.fn_symbol[f.idx()],
                ScopeKind::Class(c)
                    if matches!(bound.class_owner[c.idx()], ClassOwner::Stmt(_)) =>
                {
                    bound.class_symbol[c.idx()]
                }
                ScopeKind::Interface(id) => bound.interface_symbol[id.idx()],
                ScopeKind::Enum(e) => bound.enum_symbol[e.idx()],
                ScopeKind::Module(m) => bound.module_symbol[m.idx()],
                _ => SymbolId::NONE,
            };
        }
        for (a, &scope) in bound.alias_scope.iter().enumerate() {
            if scope.is_some() {
                u.owner_of_scope[scope.idx()] = bound.alias_symbol[a];
            }
        }
        u.has_unchecked_returns = hir.stmts.iter().any(
            |s| matches!(s.kind, StmtKind::Return(e) if e.is_some() && u.is_in_unchecked_return(e)),
        );
        u.note_references();
        if parameters {
            u.merge_type_parameters();
            u.collect_ambient_type_scopes();
        }
        if !hir.jsx.is_empty() {
            self.note_jsx_factories(file, &mut u);
        }
        if locals {
            self.note_private_reads(file, &mut u);
        }
        u.report(out);
    }

    /// `markJsxAliasReferenced`: a tag is a call of the factory, which has to be in scope where the tag is, unless a module that is there
    /// is imported for it unasked (`getJsxNamespaceContainerForImplicitImport`).
    fn note_jsx_factories(&self, file: FileId, u: &mut Unused) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (options, atoms) = (&self.p.files.options, &self.p.files.atoms);
        let runtime = crate::program::jsx_runtime_of(options, hir, atoms);
        if runtime.is_some_and(|spec| {
            self.files()
                .module_of_specifier(file, atoms.intern_str(&spec))
                .is_some()
        }) {
            return;
        }
        let (factory, fragment_factory) = super::errors_jsx::jsx_factory_names(self.files(), hir);
        for i in 0..hir.exprs.len() {
            let ExprKind::Jsx(j) = hir.exprs[i].kind else {
                continue;
            };
            if matches!(bound.expr_parent[i], Parent::None) || u.is_unchecked(ExprId(i as u32)) {
                continue;
            }
            let is_fragment = hir[j].tag.is_none();
            let scope = u.scope_of(ExprId(i as u32));
            // `symbolReferenced`: what it is made with is used even by a tag inside of it.
            if let Some(found) = u.note_name(
                scope,
                if is_fragment {
                    fragment_factory
                } else {
                    factory
                },
                SymFlags::VALUE,
                ALL,
            ) {
                u.referenced[found.idx()] |= ALL;
            }
            // `getJsxFactoryEntity`: a fragment is made with both.
            if is_fragment {
                u.note_name(scope, factory, SymFlags::VALUE, VALUE);
            }
        }
    }

    /// The private members that are read: wherever `markPropertyAsReferenced` is called.
    fn note_private_reads(&mut self, file: FileId, u: &mut Unused) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !hir
            .members
            .iter()
            .any(|m| m.flags.contains(Flags::PRIVATE) || matches!(m.key, PropKey::Private(_)))
            && !hir.params.iter().any(|p| p.flags.contains(Flags::PRIVATE))
        {
            return;
        }
        for i in 0..hir.exprs.len() {
            let e = ExprId(i as u32);
            if matches!(bound.expr_parent[i], Parent::None) || u.is_unchecked(e) {
                continue;
            }
            match hir.exprs[i].kind {
                ExprKind::Dot { obj, name, .. } => {
                    let receiver = self.type_of_expr(file, obj);
                    let receiver = self.non_nullable(receiver);
                    self.note_property(file, u, receiver, name, Some(e), None);
                }
                ExprKind::Index { obj, index, .. } => {
                    let key = self.type_of_expr(file, index);
                    if !self.is_known(key) {
                        u.reads_unknown_members = true;
                    }
                    // `shouldDeferIndexedAccessType`: nothing is looked up under a key that waits for a type parameter.
                    if self.is_generic(key) {
                        continue;
                    }
                    let receiver = self.type_of_expr(file, obj);
                    let receiver = self.non_nullable(receiver);
                    // `getIndexedAccessTypeOrUndefined`: each member of a union of keys names a property.
                    for &k in self.parts(key) {
                        if let Some(name) = self.property_name_of_type(k) {
                            self.note_property(file, u, receiver, name, Some(e), None);
                        }
                    }
                }
                // `({ x } = o)`: `checkBinaryLikeExpression`
                ExprKind::Assign {
                    op: None,
                    target,
                    value,
                } if matches!(hir[target].kind, ExprKind::Object(_) | ExprKind::Array(_)) => {
                    let source = self.type_of_expr(file, value);
                    let from_this = (matches!(hir[value].kind, ExprKind::This)
                        && !is_parenthesized(hir, value))
                    .then_some(e);
                    self.note_destructured(file, u, target, source, from_this);
                }
                // `#x in o`: `checkPrivateIdentifierExpression`. A read, whatever `o` is and wherever it is written.
                ExprKind::Binary {
                    op: BinOp::In,
                    left,
                    ..
                } => {
                    if let Some(&class) = bound.private_class.get(&left)
                        && let ExprKind::String(name) = hir[left].kind
                    {
                        // `lookupSymbolForPrivateIdentifierDeclaration`: the members of the class before its statics.
                        let is_it = |m: MemberId, is_static: bool| {
                            hir[m].key == PropKey::Private(name)
                                && hir[m].flags.contains(Flags::STATIC) == is_static
                        };
                        let is_static = !hir[class].members.iter().any(|m| is_it(m, false));
                        u.read_members
                            .extend(hir[class].members.iter().filter(|&m| is_it(m, is_static)));
                    }
                }
                _ => {}
            }
        }
        // `for ({ x } of os)`: `checkForOfStatement`
        for (i, s) in hir.stmts.iter().enumerate() {
            if let StmtKind::ForOf {
                left,
                expr,
                is_await,
                ..
            } = s.kind
                && !matches!(bound.stmt_parent[i], Parent::None)
                && !hir.is_in_with(s.pos)
                && let StmtKind::Expr(target) = hir[left].kind
                && matches!(hir[target].kind, ExprKind::Object(_) | ExprKind::Array(_))
            {
                let gone_through = self.type_of_expr(file, expr);
                let source = self.iterated_type(gone_through, is_await);
                self.note_destructured(file, u, target, source, None);
            }
        }
        // `const { x } = o`: `checkVariableLikeDeclaration`. Whatever a binding element goes by is looked up in what is taken apart, be it
        // the name of a rest element or of an element of an array pattern.
        for i in 0..hir.pats.len() {
            if hir.is_in_with(hir.pats[i].pos) {
                continue;
            }
            match hir.pats[i].kind {
                PatKind::Object(props) => {
                    let whole = self.type_of_pat(file, PatId(i as u32));
                    for p in props.iter() {
                        let name = match hir[hir[p].value].kind {
                            PatKind::Ident(name) if hir[p].is_rest => Some(name),
                            _ => self.member_name(file, hir[p].key),
                        };
                        if let Some(name) = name {
                            self.note_property(file, u, whole, name, None, None);
                        }
                    }
                }
                PatKind::Array(elems) => {
                    let whole = self.type_of_pat(file, PatId(i as u32));
                    for element in elems.iter() {
                        if let PatKind::Ident(name) = hir[hir[element].pat].kind {
                            self.note_property(file, u, whole, name, None, None);
                        }
                    }
                }
                _ => {}
            }
        }
    }

    /// `checkDestructuringAssignment`: `target`, the pattern of a destructuring assignment or part of one, is given a `source`.
    /// `from_this`: the assignment, if `target` is all of its pattern and what is taken apart is written `this`.
    fn note_destructured(
        &mut self,
        file: FileId,
        u: &mut Unused,
        target: ExprId,
        source: TypeId,
        from_this: Option<ExprId>,
    ) {
        let hir = self.hir(file);
        // Whether `e` is a pattern in its turn, with or without a default.
        let is_pattern = |e: ExprId| {
            let e = match hir[e].kind {
                ExprKind::Assign {
                    op: None, target, ..
                } => target,
                _ => e,
            };
            matches!(hir[e].kind, ExprKind::Object(_) | ExprKind::Array(_))
        };
        match hir[target].kind {
            // The default is assigned too, which is an assignment like any other.
            ExprKind::Assign {
                op: None, target, ..
            } => {
                let source = if self.p.files.options.strict_null_checks {
                    self.without_undefined(source)
                } else {
                    source
                };
                self.note_destructured(file, u, target, source, None);
            }
            // `checkObjectLiteralDestructuringPropertyAssignment`
            ExprKind::Object(props) => {
                for p in props.iter() {
                    if !matches!(hir[p].kind, PropKind::Init | PropKind::Shorthand) {
                        continue;
                    }
                    let Some(name) = self.member_name(file, hir[p].key) else {
                        continue;
                    };
                    self.note_property(file, u, source, name, None, from_this);
                    if hir[p].value.is_some()
                        && is_pattern(hir[p].value)
                        && let Some(element) = self.type_of_property(source, name)
                    {
                        self.note_destructured(file, u, hir[p].value, element, None);
                    }
                }
            }
            // `checkArrayLiteralAssignment`
            ExprKind::Array(items) => {
                for (i, item) in hir.ids(items).enumerate() {
                    let (item, is_rest) = match hir[item].kind {
                        ExprKind::Spread(rest) => (rest, true),
                        _ => (item, false),
                    };
                    if is_pattern(item) {
                        let element = self.element_of_destructured(source, i, is_rest);
                        self.note_destructured(file, u, item, element, None);
                    }
                }
            }
            _ => {}
        }
    }

    /// `markPropertyAsReferenced`, of the property `name` of `receiver`. `at`: the `a.b` or `a[b]` that gets at it, if that is how.
    /// `from_this`: the assignment, for a property named in the pattern of `({ b } = this)`.
    fn note_property(
        &mut self,
        file: FileId,
        u: &mut Unused,
        receiver: TypeId,
        name: Atom,
        at: Option<ExprId>,
        from_this: Option<ExprId>,
    ) {
        let is_this_type = matches!(self.data(receiver), TypeData::ThisParam(_));
        let receiver = self.apparent_type(receiver);
        // `createUnionOrIntersectionProperty`: what is private has to be there in every member of a union. It is the property of the first
        // if that of each is the same. If not there is none, or one made up for the occasion, and that is what is marked.
        let mut found: Option<(Prop, MapperId)> = None;
        for &part in self.parts(receiver) {
            let part = self.apparent_type(part);
            if part == TypeId::UNRESOLVED {
                return u.note_members_named(name);
            }
            let Some((mut prop, mut mapper)) = self.prop_of(part, name) else {
                return;
            };
            if let PropSource::Intersected(_, list) = &prop.source {
                let Some(first) = list.first() else { return };
                if list.iter().any(|other| {
                    !self.is_same_property(first, MapperId::IDENTITY, other, MapperId::IDENTITY)
                }) {
                    return;
                }
                (prop, mapper) = (first.clone(), MapperId::IDENTITY);
            }
            let Some(first) = &found else {
                let is_private = match &prop.source {
                    PropSource::Members(members) => members.iter().any(|&(f, m)| {
                        let member = &self.hir(f)[m];
                        member.flags.contains(Flags::PRIVATE)
                            || matches!(member.key, PropKey::Private(_))
                    }),
                    PropSource::Parameter(f, p) => self.hir(*f)[*p].flags.contains(Flags::PRIVATE),
                    _ => false,
                };
                if !is_private {
                    return;
                }
                found = Some((prop, mapper));
                continue;
            };
            if !self.is_same_property(&first.0, first.1, &prop, mapper) {
                return;
            }
        }
        let Some((prop, _)) = found else { return };
        let is_write_only = at.is_some_and(|e| u.is_write_only(e));
        match &prop.source {
            PropSource::Members(members) => {
                // Written to and no more, unless writing runs a setter.
                let has_setter = members.iter().any(|&(f, m)| {
                    let member = &self.hir(f)[m];
                    member.kind == MemberKind::Setter || member.flags.contains(Flags::ACCESSOR)
                });
                if is_write_only && !has_setter {
                    return;
                }
                // Got at through the class itself from inside the member, whichever of its declarations that is: no use of it.
                if (from_this.is_some()
                    || at.is_some_and(|e| self.is_self_type_access(file, e, receiver)))
                    && let Some(inside) = at.or(from_this).and_then(|e| u.enclosing_member_fn(e))
                    && members.contains(&(file, inside))
                    && (is_this_type || self.is_uninstantiated(file, members))
                {
                    return;
                }
                u.read_members
                    .extend(members.iter().filter(|m| m.0 == file).map(|m| m.1));
            }
            PropSource::Parameter(of, p) if *of == file && !is_write_only => {
                u.read_parameter_properties.push(*p)
            }
            _ => {}
        }
    }

    /// Whether `createUnionOrIntersectionProperty` takes the two for one property: one declaration, of one type.
    fn is_same_property(
        &mut self,
        a: &Prop,
        a_mapper: MapperId,
        b: &Prop,
        b_mapper: MapperId,
    ) -> bool {
        a.source == b.source && {
            let (a, b) = (
                self.type_of_prop(a, a_mapper),
                self.type_of_prop(b, b_mapper),
            );
            a == b || !self.is_known(a) || !self.is_known(b)
        }
    }

    /// `isSelfTypeAccess`, of `e`: `obj.name`, or `obj[key]` where `of` is what `obj` is to a property access.
    fn is_self_type_access(&self, file: FileId, e: ExprId, of: TypeId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (obj, is_dot) = match hir[e].kind {
            ExprKind::Dot { obj, .. } => (obj, true),
            ExprKind::Index { obj, .. } => (obj, false),
            _ => return false,
        };
        if is_parenthesized(hir, obj) {
            return false;
        }
        if matches!(hir[obj].kind, ExprKind::This) {
            return true;
        }
        // What `a` of `a.b` means is compared with what its first identifier means. Of `a.c.b` that is the property `c`, which `a` does not mean.
        if is_dot {
            return matches!(hir[obj].kind, ExprKind::Ident(_));
        }
        // `IsEntityNameExpression`, `GetFirstIdentifier`
        let mut first = obj;
        while let ExprKind::Dot { obj, name, .. } = hir[first].kind {
            if is_parenthesized(hir, obj) || self.files().atoms.bytes(name).first() == Some(&b'#') {
                return false;
            }
            first = obj;
        }
        // Of `a[k]` it is the symbol of the type of `a`: the class.
        let class = match self.data(of) {
            TypeData::Ref { target, .. } => *target,
            TypeData::Anon {
                origin: Origin::ClassStatic(class),
                ..
            } => *class,
            _ => return false,
        };
        let symbol = bound.expr_symbol[first.idx()];
        matches!(hir[first].kind, ExprKind::Ident(_))
            && symbol.is_some()
            && self.files().sym(file, symbol) == class
            // The name of what is exported where it is declared means the local symbol, and the type has the exported one.
            && !bound.symbols[symbol.idx()].decls.iter().any(|d| matches!(*d, Decl::Class(c) if hir[c].flags.contains(Flags::EXPORT)))
    }

    /// Whether the property `members` declare is the symbol declared in whatever type it is found in: `instantiateSymbol` leaves it alone.
    fn is_uninstantiated(&mut self, file: FileId, members: &[(FileId, MemberId)]) -> bool {
        // The static side has the exports of the class themselves.
        if members
            .iter()
            .all(|&(f, m)| self.hir(f)[m].flags.contains(Flags::STATIC))
        {
            return true;
        }
        // `isThisless`, in a class where `this` is all there is to instantiate.
        let &[(of, m)] = members else { return false };
        if of != file {
            return false;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let MemberOwner::Class(class) = bound.member_owner[m.idx()] else {
            return false;
        };
        is_thisless(hir, m)
            && self
                .outer_type_params(file, bound.class_scope[class.idx()])
                .iter()
                .all(|&t| matches!(self.data(t), TypeData::ThisParam(_)))
    }
}

/// Whether `e` is written in parentheses of its own.
fn is_parenthesized(hir: &hir::File, e: ExprId) -> bool {
    hir.parens.binary_search_by_key(&e.0, |p| p.0.0).is_ok()
}

/// The position of the bracket that closes the brackets around `from`, or the end of `text`. Brackets in strings and comments count
/// as well.
fn closing_bracket_after(text: &[u8], from: usize) -> u32 {
    let mut depth = 0u32;
    for (i, &c) in text.iter().enumerate().skip(from) {
        match c {
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' if depth == 0 => return i as u32,
            b')' | b']' | b'}' => depth -= 1,
            _ => {}
        }
    }
    text.len() as u32
}

/// `isThisless`, of a method or an accessor.
fn is_thisless(hir: &hir::File, m: MemberId) -> bool {
    if !matches!(
        hir[m].kind,
        MemberKind::Method | MemberKind::Getter | MemberKind::Setter
    ) || hir[m].func.is_none()
    {
        return false;
    }
    let f = &hir[hir[m].func];
    // `isThislessVariableLikeDeclaration`
    let is_thisless_parameter = |p: ParamId| {
        if hir[p].ty.is_some() {
            is_thisless_type(hir, hir[p].ty)
        } else {
            hir[p].default.is_none()
        }
    };
    f.ret.is_some()
        && is_thisless_type(hir, f.ret)
        && (f.this_ty.is_none() || is_thisless_type(hir, f.this_ty))
        && f.params.iter().all(is_thisless_parameter)
        && f.type_params
            .iter()
            .all(|t| hir[t].constraint.is_none() || is_thisless_type(hir, hir[t].constraint))
}

/// `isThislessType`
fn is_thisless_type(hir: &hir::File, t: TypeNodeId) -> bool {
    // A type in parentheses is not looked into. Only the text tells.
    if hir
        .text
        .get(..hir[t].pos as usize)
        .is_some_and(|before| before.trim_ascii_end().ends_with(b"("))
    {
        return false;
    }
    match hir[t].kind {
        TypeNodeKind::Keyword(keyword) => !matches!(keyword, Keyword::This | Keyword::Intrinsic),
        TypeNodeKind::StringLit(_)
        | TypeNodeKind::NumberLit(_)
        | TypeNodeKind::BigIntLit { .. }
        | TypeNodeKind::BoolLit(_) => true,
        TypeNodeKind::Array(element) => is_thisless_type(hir, element),
        TypeNodeKind::Ref { args, .. } => hir.ids(args).all(|a| is_thisless_type(hir, a)),
        _ => false,
    }
}

/// Adds the scope of every signature and every `infer` type parameter in the type `node` to `scopes`.
fn collect_type_scopes(
    hir: &hir::File,
    bound: &Bound,
    node: TypeNodeId,
    scopes: &mut Vec<ScopeId>,
) {
    if node.is_none() {
        return;
    }
    match hir[node].kind {
        TypeNodeKind::Fn(f) => collect_signature_scopes(hir, bound, f, scopes),
        TypeNodeKind::Object(members) => {
            for m in members.iter() {
                collect_type_scopes(hir, bound, hir[m].ty, scopes);
                if hir[m].func.is_some() {
                    collect_signature_scopes(hir, bound, hir[m].func, scopes);
                }
            }
        }
        TypeNodeKind::Infer(p) => {
            scopes.push(bound.type_param_scope[p.idx()]);
            collect_type_scopes(hir, bound, hir[p].constraint, scopes);
        }
        TypeNodeKind::Ref { args: types, .. }
        | TypeNodeKind::Typeof { args: types, .. }
        | TypeNodeKind::Import { args: types, .. }
        | TypeNodeKind::Template { types, .. }
        | TypeNodeKind::Union(types)
        | TypeNodeKind::Intersection(types) => {
            for t in hir.ids(types) {
                collect_type_scopes(hir, bound, t, scopes);
            }
        }
        TypeNodeKind::Array(t)
        | TypeNodeKind::Keyof(t)
        | TypeNodeKind::Readonly(t)
        | TypeNodeKind::Predicate { ty: t, .. } => {
            collect_type_scopes(hir, bound, t, scopes);
        }
        TypeNodeKind::Tuple(elems) => {
            for e in elems.iter() {
                collect_type_scopes(hir, bound, hir[e].ty, scopes);
            }
        }
        TypeNodeKind::Cond {
            check,
            extends,
            yes,
            no,
        } => {
            for t in [check, extends, yes, no] {
                collect_type_scopes(hir, bound, t, scopes);
            }
        }
        TypeNodeKind::IndexedAccess { obj, index } => {
            collect_type_scopes(hir, bound, obj, scopes);
            collect_type_scopes(hir, bound, index, scopes);
        }
        TypeNodeKind::Mapped(m) => {
            for t in [hir[hir[m].param].constraint, hir[m].name_ty, hir[m].ty] {
                collect_type_scopes(hir, bound, t, scopes);
            }
        }
        _ => {}
    }
}

/// The same for the signature `f`: its own scope, and those in the types of its type parameters, its parameters and its return type.
fn collect_signature_scopes(hir: &hir::File, bound: &Bound, f: FnId, scopes: &mut Vec<ScopeId>) {
    scopes.push(bound.fns[f.idx()].scope);
    let f = &hir[f];
    for p in f.type_params.iter() {
        collect_type_scopes(hir, bound, hir[p].constraint, scopes);
        collect_type_scopes(hir, bound, hir[p].default, scopes);
    }
    collect_type_scopes(hir, bound, f.this_ty, scopes);
    for p in f.params.iter() {
        collect_type_scopes(hir, bound, hir[p].ty, scopes);
    }
    collect_type_scopes(hir, bound, f.ret, scopes);
}

impl Unused<'_> {
    // ───────────────────────────── what is referred to ─────────────────────────────

    fn note_references(&mut self) {
        let (hir, bound) = (self.hir, self.bound);
        for i in 0..hir.exprs.len() {
            let e = ExprId(i as u32);
            if !matches!(hir.exprs[i].kind, ExprKind::Ident(_))
                || matches!(bound.expr_parent[i], Parent::None)
            {
                continue;
            }
            let symbol = bound.expr_symbol[i];
            if symbol.is_none()
                || self.is_unchecked(e)
                || self.is_write_only(e)
                || self.is_inside_declaration_of(e, symbol)
            {
                continue;
            }
            // `checkVariableLikeDeclaration` only validates the alias that `const x = require("m")` declares. It does not check the
            // initializer, so it does not resolve the callee.
            if let Parent::Expr(call) = bound.expr_parent[i]
                && call.is_some()
                && let Parent::VarInit(d) = bound.expr_parent[call.idx()]
                && matches!(hir[hir[d].pat].kind, PatKind::Ident(_))
                && bound.required_by(hir, hir[d].pat).is_some()
            {
                continue;
            }
            self.referenced[symbol.idx()] |= VALUE;
        }
        for i in 0..hir.types.len() {
            let scope = bound.type_scope[i];
            let TypeNodeKind::Ref { name, .. } = hir.types[i].kind else {
                continue;
            };
            if scope.is_none() || hir.is_in_with(hir.types[i].pos) {
                continue;
            }
            let Some(first) = hir.ids(name).next() else {
                continue;
            };
            let (meaning, bit) = if name.len() == 1 {
                (SymFlags::TYPE, TYPE)
            } else {
                (SymFlags::NAMESPACE, NAMESPACE)
            };
            self.note_name(scope, first, meaning, bit);
        }
        for (i, s) in hir.stmts.iter().enumerate() {
            if matches!(bound.stmt_parent[i], Parent::None) {
                continue;
            }
            match s.kind {
                // `export { a }` uses `a`, whatever it is.
                StmtKind::ExportNamed(id) if hir[id].spec.is_none() => {
                    let scope = bound.export_scope[id.idx()];
                    for item in hir[id].items.iter() {
                        self.note_name(scope, hir[item].local, SymFlags::all(), ALL);
                    }
                }
                StmtKind::ImportEquals(id) => {
                    if let ImportEqualsTarget::Entity(names) = hir[id].target
                        && let Some(first) = hir.ids(names).next()
                    {
                        self.note_name(
                            bound.import_equals_scope[id.idx()],
                            first,
                            SymFlags::all(),
                            ALL,
                        );
                    }
                }
                _ => {}
            }
        }
        // `export default I`, `export = I`: a type will do.
        for &(e, scope) in &bound.free_idents {
            if let Parent::Stmt(s) = bound.expr_parent[e.idx()]
                && matches!(
                    hir[s].kind,
                    StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_)
                )
                && let ExprKind::Ident(name) = hir[e].kind
            {
                self.note_name(scope, name, SymFlags::all(), ALL);
            }
        }
    }

    /// The type parameters of the declarations of one class or interface are the same ones, name for name (`getMergedSymbol`): a use of
    /// one is a use of it in all of them.
    fn merge_type_parameters(&mut self) {
        let (hir, bound) = (self.hir, self.bound);
        for symbol in &bound.symbols {
            let lists = || {
                symbol.decls.iter().filter_map(|d| match *d {
                    Decl::Class(c) => Some(hir[c].type_params),
                    Decl::Interface(i) => Some(hir[i].type_params),
                    _ => None,
                })
            };
            if lists().count() < 2 {
                continue;
            }
            for p in lists().flat_map(|list| list.iter()) {
                for q in lists().flat_map(|list| list.iter()) {
                    let (a, b) = (
                        bound.type_param_symbol[p.idx()],
                        bound.type_param_symbol[q.idx()],
                    );
                    if hir[p].name == hir[q].name && a.is_some() && b.is_some() {
                        let uses = self.referenced[b.idx()] & TYPE;
                        self.referenced[a.idx()] |= uses;
                    }
                }
            }
        }
    }

    /// A property `name` of something that could not be worked out is got at: whatever goes by the name may be what is read.
    fn note_members_named(&mut self, name: Atom) {
        let hir = self.hir;
        self.read_members.extend(
            (0..hir.members.len() as u32)
                .map(MemberId)
                .filter(|&m| hir[m].key.name() == Some(name)),
        );
        let is_it = |p: &ParamId| {
            hir[*p].flags.contains(Flags::PRIVATE)
                && matches!(hir[hir[*p].pat].kind, PatKind::Ident(n) if n == name)
        };
        self.read_parameter_properties
            .extend((0..hir.params.len() as u32).map(ParamId).filter(is_it));
    }

    /// The scope `e` is written in. Unless the binder kept it, that of the innermost function, class or namespace around.
    fn scope_of(&self, e: ExprId) -> ScopeId {
        let bound = self.bound;
        if let Some(&scope) = bound.expr_scope.get(&e) {
            return scope;
        }
        let mut scope = ScopeId(0);
        self.is_written_in(e, |around| {
            let found = match around {
                Around::Fn(f) => Some(bound.fns[f.idx()].scope),
                Around::Class(class) => Some(bound.class_scope[class.idx()]),
                Around::Module(m) => bound
                    .scopes
                    .iter()
                    .position(|s| s.kind == ScopeKind::Module(m))
                    .map(|i| ScopeId(i as u32)),
                Around::Enum(_) | Around::Return(_) => None,
            };
            scope = found.unwrap_or(scope);
            found.is_some()
        });
        scope
    }

    /// `Resolve` with `isUse`. What the name means, if that is declared in the file.
    fn note_name(
        &mut self,
        from: ScopeId,
        name: Atom,
        meaning: SymFlags,
        bit: u8,
    ) -> Option<SymbolId> {
        let bound = self.bound;
        let mut scope = from;
        // The declaration furthest out that the name is written in, short of where it is found.
        let mut inside = SymbolId::NONE;
        while scope.is_some() {
            let s = &bound.scopes[scope.idx()];
            let mut found = bound.lookup(s.locals, name).filter(|f| {
                bound.symbols[f.idx()]
                    .flags
                    .intersects(meaning | SymFlags::ALIAS)
            });
            if found.is_none() && s.symbol.is_some() {
                found = bound
                    .lookup(bound.symbols[s.symbol.idx()].exports, name)
                    .filter(|f| {
                        bound.symbols[f.idx()]
                            .flags
                            .intersects(meaning | SymFlags::ALIAS)
                    });
            }
            if let Some(found) = found {
                if found != inside {
                    self.referenced[found.idx()] |= bit;
                }
                return Some(found);
            }
            if self.owner_of_scope[scope.idx()].is_some() {
                inside = self.owner_of_scope[scope.idx()];
            }
            scope = s.parent;
        }
        None
    }

    /// `IsWriteOnlyAccess`
    fn is_write_only(&self, e: ExprId) -> bool {
        self.access_kind(e) == 1
    }

    /// `accessKind`: 0 for read, 1 for write, 2 for both.
    fn access_kind(&self, e: ExprId) -> u8 {
        let (hir, bound) = (self.hir, self.bound);
        match bound.expr_parent[e.idx()] {
            Parent::Expr(parent) => match hir[parent].kind {
                ExprKind::Unary {
                    op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                    ..
                } => 2,
                ExprKind::Assign { op, target, .. } if target == e => {
                    if op.is_none() {
                        1
                    } else {
                        2
                    }
                }
                ExprKind::Array(_) => self.access_kind(parent),
                _ => 0,
            },
            // What is spread into counts as read.
            Parent::Prop(p) => {
                let owner = bound.prop_owner[p.idx()];
                let is_target = hir[p].kind != PropKind::Spread
                    && owner.is_some()
                    && matches!(hir[owner].kind, ExprKind::Object(_));
                if is_target {
                    self.access_kind(owner)
                } else {
                    0
                }
            }
            Parent::Stmt(s) if s.is_some() => match bound.stmt_parent[s.idx()] {
                // `for (x of xs)`
                Parent::Stmt(outer) if outer.is_some() => match hir[outer].kind {
                    StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == s => 1,
                    _ => 0,
                },
                _ => 0,
            },
            _ => 0,
        }
    }

    /// Whether `e` is written in a function, class, enum or namespace declaration of `symbol`: `isSelfReferenceLocation`.
    fn is_inside_declaration_of(&self, e: ExprId, symbol: SymbolId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        bound.symbols[symbol.idx()]
            .flags
            .intersects(SymFlags::FUNCTION | SymFlags::CLASS | SymFlags::ENUM | SymFlags::MODULE)
            && self.is_written_in(e, |around| {
                symbol
                    == match around {
                        Around::Fn(f) if hir[f].kind == FnKind::Decl => bound.fn_symbol[f.idx()],
                        Around::Class(class)
                            if matches!(bound.class_owner[class.idx()], ClassOwner::Stmt(_)) =>
                        {
                            bound.class_symbol[class.idx()]
                        }
                        Around::Enum(e) => bound.enum_symbol[e.idx()],
                        Around::Module(m) => bound.module_symbol[m.idx()],
                        _ => SymbolId::NONE,
                    }
            })
    }

    /// The method or accessor of a class `e` is directly in: `FindAncestor(e, IsFunctionLikeDeclaration)`, if that is one.
    fn enclosing_member_fn(&self, e: ExprId) -> Option<MemberId> {
        let (hir, bound) = (self.hir, self.bound);
        let mut found = None;
        self.is_written_in(e, |around| match around {
            // A static block is no function.
            Around::Fn(f) if hir[f].kind != FnKind::StaticBlock => {
                if let FnOwner::Member(m) = bound.fns[f.idx()].owner {
                    found = Some(m);
                }
                true
            }
            _ => false,
        });
        found
    }

    /// Whether the checker never visits `e`, so that nothing in `e` counts as a reference. `checkWithStatement` does not check the body
    /// of a `with` statement.
    fn is_unchecked(&self, e: ExprId) -> bool {
        self.hir.is_in_with(self.hir[e].pos)
            || self.has_unchecked_returns && self.is_in_unchecked_return(e)
    }

    /// Whether `e` is in the expression of a `return` that is outside a function or directly in a class static block.
    /// `checkReturnStatement` reports such a statement and returns before it checks the expression.
    fn is_in_unchecked_return(&self, e: ExprId) -> bool {
        let hir = self.hir;
        // A `return` was visited, and the function that contains it has not been reached yet.
        let mut in_return = false;
        let is_in_static_block = self.is_written_in(e, |around| match around {
            Around::Return(_) => {
                in_return = true;
                false
            }
            Around::Fn(f) => std::mem::take(&mut in_return) && hir[f].kind == FnKind::StaticBlock,
            _ => false,
        });
        is_in_static_block || in_return
    }

    /// Visits the functions, classes, enums, namespaces and `return` statements that contain `e`, innermost first, until `is_it` returns
    /// true for one. Returns whether it did.
    fn is_written_in(&self, e: ExprId, mut is_it: impl FnMut(Around) -> bool) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        // A pattern is where the variable or the parameter is.
        let of_pattern = |part: PatId| match self.root_of(part) {
            PatParent::Var(d) => Parent::VarInit(d),
            PatParent::Param(p) => Parent::ParamDefault(p),
            _ => Parent::None,
        };
        // The name and the decorators of a method or an accessor are part of it. Those of a property are part of the class.
        let of_member = |m: MemberId| {
            if hir[m].func.is_some() {
                Parent::FnBody(hir[m].func)
            } else {
                Parent::MemberInit(m)
            }
        };
        let mut parent = bound.expr_parent[e.idx()];
        // The expression `parent` is the parent of, where it is that of an expression.
        let mut below = e;
        loop {
            let around = match parent {
                Parent::FnBody(f) => Around::Fn(f),
                Parent::ParamDefault(p) => Around::Fn(bound.param_fn[p.idx()]),
                Parent::ClassExtends(class) => Around::Class(class),
                Parent::MemberInit(m) => match bound.member_owner[m.idx()] {
                    MemberOwner::Class(class) => Around::Class(class),
                    _ => return false,
                },
                Parent::EnumInit(member) => Around::Enum(bound.enum_member_owner[member.idx()]),
                Parent::Module(m) => Around::Module(m),
                Parent::Stmt(s) if s.is_some() && matches!(hir[s].kind, StmtKind::Return(_)) => {
                    Around::Return(s)
                }
                _ => {
                    parent = match parent {
                        Parent::Expr(x) if x.is_some() => {
                            below = x;
                            bound.expr_parent[x.idx()]
                        }
                        Parent::Stmt(s) if s.is_some() => bound.stmt_parent[s.idx()],
                        Parent::VarInit(d) => Parent::Stmt(bound.var_stmt[d.idx()]),
                        Parent::Prop(p) => Parent::Expr(bound.prop_owner[p.idx()]),
                        Parent::Case(c) => Parent::Stmt(bound.case_stmt[c.idx()]),
                        Parent::PatPropDefault(p) => of_pattern(hir[p].value),
                        Parent::PatElemDefault(p) => of_pattern(hir[p].pat),
                        Parent::Decorator(class, DecoratorOwner::Class(_)) => {
                            Parent::ClassExtends(class)
                        }
                        Parent::Decorator(_, DecoratorOwner::Member(m)) => of_member(m),
                        Parent::Decorator(_, DecoratorOwner::Param(p)) => Parent::ParamDefault(p),
                        Parent::Key(owner) if owner.is_some() => Parent::Expr(owner),
                        // In a pattern.
                        Parent::Key(_) => match hir
                            .pat_props
                            .iter()
                            .find(|p| p.key == PropKey::Computed(below))
                        {
                            Some(p) => of_pattern(p.value),
                            None => return false,
                        },
                        Parent::MemberKey => {
                            if let Some(m) = hir
                                .members
                                .iter()
                                .position(|m| m.key == PropKey::Computed(below))
                            {
                                of_member(MemberId(m as u32))
                            } else if let Some(p) = hir
                                .props
                                .iter()
                                .position(|p| p.key == PropKey::Computed(below))
                            {
                                // Of a method or an accessor of an object literal.
                                match hir.props[p].value.some().map(|value| hir[value].kind) {
                                    Some(ExprKind::Fn(f)) => Parent::FnBody(f),
                                    _ => Parent::Expr(bound.prop_owner[p]),
                                }
                            } else {
                                return false;
                            }
                        }
                        _ => return false,
                    };
                    continue;
                }
            };
            if is_it(around) {
                return true;
            }
            parent = match around {
                Around::Fn(f) => match bound.fns[f.idx()].owner {
                    FnOwner::Expr(x) => Parent::Expr(x),
                    FnOwner::Stmt(s) => Parent::Stmt(s),
                    FnOwner::Member(m) => Parent::MemberInit(m),
                    _ => return false,
                },
                Around::Class(class) => match bound.class_owner[class.idx()] {
                    ClassOwner::Expr(x) => Parent::Expr(x),
                    ClassOwner::Stmt(s) => Parent::Stmt(s),
                },
                Around::Enum(e) => Parent::Stmt(self.stmt_of_enum[e.idx()]),
                Around::Module(m) => Parent::Stmt(self.stmt_of_module[m.idx()]),
                Around::Return(s) => bound.stmt_parent[s.idx()],
            };
        }
    }

    // ───────────────────────────── what is said ─────────────────────────────

    fn report(&self, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir, self.bound);
        for (i, scope) in bound.scopes.iter().enumerate() {
            let checks_locals = match scope.kind {
                // `checkSourceFile`: `IsExternalOrCommonJSModule`
                ScopeKind::File => hir.has_module_syntax || bound.commonjs_indicator.is_some(),
                ScopeKind::Module(_) | ScopeKind::Block => true,
                // Of overloads only the implementation.
                ScopeKind::Fn(f) => {
                    !matches!(hir[f].body, FnBody::None)
                        && matches!(
                            hir[f].kind,
                            FnKind::Decl
                                | FnKind::Expr
                                | FnKind::Arrow
                                | FnKind::Method
                                | FnKind::Getter
                                | FnKind::Setter
                                | FnKind::Constructor
                        )
                }
                _ => false,
            };
            if checks_locals && !self.is_ambient_scope(ScopeId(i as u32)) {
                self.report_locals_and_parameters(ScopeId(i as u32), out);
            }
        }
        if self.parameters {
            for (i, f) in hir.fns.iter().enumerate() {
                // Set for function declarations and named function expressions only. A method that several files declare in one
                // interface is one symbol too, which is not tracked.
                let symbol = bound.fn_symbol[i];
                if !f.type_params.is_empty()
                    && !f.flags.contains(Flags::AMBIENT)
                    && !self.is_ambient_scope(bound.fns[i].scope)
                    && (symbol.is_none() || self.is_declared_in_one_file(symbol))
                {
                    self.report_type_parameters(f.type_params, out);
                }
            }
            for (i, c) in hir.classes.iter().enumerate() {
                if !c.flags.contains(Flags::AMBIENT)
                    && self.is_declared_in_one_file(bound.class_symbol[i])
                {
                    self.report_type_parameters(c.type_params, out);
                }
            }
            for a in &hir.aliases {
                if !a.flags.contains(Flags::AMBIENT) {
                    self.report_type_parameters(a.type_params, out);
                }
            }
            for (i, id) in hir.interfaces.iter().enumerate() {
                if !id.flags.contains(Flags::AMBIENT)
                    && self.is_declared_in_one_file(bound.interface_symbol[i])
                {
                    self.report_type_parameters(id.type_params, out);
                }
            }
            for t in &hir.types {
                if let TypeNodeKind::Infer(param) = t.kind
                    && hir[param].name != known::empty
                    && self.is_unreferenced_type_parameter(param)
                    && !self.is_ambient_scope(bound.type_param_scope[param.idx()])
                {
                    out.push(Diagnostic {
                        start: hir[param].pos,
                        code: 6196,
                    });
                }
            }
        }
        if self.locals {
            self.report_class_members(out);
        }
    }

    /// `allDeclarationsInSameSourceFile`
    fn is_declared_in_one_file(&self, symbol: SymbolId) -> bool {
        symbol.is_some()
            && !self.bound.symbols[symbol.idx()]
                .flags
                .contains(SymFlags::MERGED)
    }

    /// `reportUnused` reports nothing for a node that has `NodeFlagsAmbient`. That is a context flag of the parser: every node under a
    /// `declare` has it, down to the signatures and `infer` types in the type of a variable.
    fn is_ambient_scope(&self, mut scope: ScopeId) -> bool {
        while scope.is_some() {
            let s = &self.bound.scopes[scope.idx()];
            let ambient = match s.kind {
                ScopeKind::Module(m) => self.hir[m].flags.contains(Flags::AMBIENT),
                ScopeKind::Fn(f) => self.hir[f].flags.contains(Flags::AMBIENT),
                ScopeKind::Class(c) => self.hir[c].flags.contains(Flags::AMBIENT),
                ScopeKind::Interface(i) => self.hir[i].flags.contains(Flags::AMBIENT),
                _ => false,
            };
            if ambient || self.ambient_type_scopes.binary_search(&scope).is_ok() {
                return true;
            }
            scope = s.parent;
        }
        false
    }

    /// Fills `ambient_type_scopes`.
    fn collect_ambient_type_scopes(&mut self) {
        let (hir, bound) = (self.hir, self.bound);
        let scopes = &mut self.ambient_type_scopes;
        for (i, alias) in hir.aliases.iter().enumerate() {
            if alias.flags.contains(Flags::AMBIENT) {
                scopes.push(bound.alias_scope[i]);
            }
        }
        for d in &hir.var_decls {
            if d.flags.contains(Flags::AMBIENT) {
                collect_type_scopes(hir, bound, d.ty, scopes);
            }
        }
        for member in &hir.members {
            if member.flags.contains(Flags::AMBIENT) {
                collect_type_scopes(hir, bound, member.ty, scopes);
            }
        }
        scopes.sort_unstable();
    }

    /// `checkUnusedLocalsAndParameters`
    fn report_locals_and_parameters(&self, scope: ScopeId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir, self.bound);
        let s = &bound.scopes[scope.idx()];
        let exports = if s.symbol.is_some() {
            bound.symbols[s.symbol.idx()].exports
        } else {
            crate::bind::TableId::NONE
        };
        let mut var_stmts: Vec<StmtId> = Vec::new();
        let mut fns: Vec<FnId> = Vec::new();
        let mut imports: Vec<(ImportId, u32)> = Vec::new();
        for &(name, local) in bound.table(s.locals) {
            // A missing name is a syntax error inside its declaration, so `reportUnused` drops what is reported for it.
            if name == known::empty || name.is_none() {
                continue;
            }
            let symbol = &bound.symbols[local.idx()];
            let kinds = self.referenced[local.idx()];
            let is_type_parameter = symbol.flags.contains(SymFlags::TYPE_PARAMETER);
            if is_type_parameter
                && (!symbol.flags.intersects(SymFlags::VARIABLE) || kinds & VALUE != 0)
            {
                continue;
            }
            if !is_type_parameter
                && (kinds != 0
                    || bound.lookup(exports, name) == Some(local)
                    || symbol.flags.contains(SymFlags::MODULE_EXPORTS))
            {
                continue;
            }
            let starts_with_underscore = self.starts_with_underscore(name);
            for &decl in &symbol.decls {
                match decl {
                    // The declaration of a `require` alias is its variable declaration or binding element.
                    Decl::Var(pat) | Decl::Param(pat) | Decl::Require(pat) => {
                        match self.root_of(pat) {
                            PatParent::Var(d) => {
                                let stmt = bound.var_stmt[d.idx()];
                                if stmt.is_some()
                                    && matches!(hir[stmt].kind, StmtKind::Var(_))
                                    && !var_stmts.contains(&stmt)
                                {
                                    var_stmts.push(stmt);
                                }
                            }
                            PatParent::Param(p) => {
                                let f = bound.param_fn[p.idx()];
                                if !fns.contains(&f) {
                                    fns.push(f);
                                }
                            }
                            _ => {}
                        }
                    }
                    Decl::ImportDefault(id) if !starts_with_underscore => {
                        imports.push((id, hir[id].default_pos))
                    }
                    Decl::ImportNamespace(id) if !starts_with_underscore => {
                        imports.push((id, hir[id].namespace_pos))
                    }
                    Decl::ImportSpec(spec) if !starts_with_underscore => {
                        if let Some(id) = (0..hir.imports.len())
                            .find(|&i| hir.imports[i].named.range().contains(&spec.idx()))
                        {
                            imports.push((ImportId(id as u32), hir[spec].pos));
                        }
                    }
                    Decl::ImportDefault(_) | Decl::ImportNamespace(_) | Decl::ImportSpec(_) => {}
                    _ if self.declaration_has_syntax_error(decl) => {}
                    // The name of a function or class expression is nobody's local.
                    Decl::Fn(f) if hir[f].kind != FnKind::Decl => {}
                    // `export default function f() {}`
                    Decl::Fn(f)
                        if !hir[f]
                            .flags
                            .intersects(Flags::AMBIENT | Flags::EXPORT | Flags::DEFAULT) =>
                    {
                        self.local(hir[f].name_pos, 6133, out)
                    }
                    Decl::Class(c) if matches!(bound.class_owner[c.idx()], ClassOwner::Expr(_)) => {
                    }
                    Decl::Class(c)
                        if !hir[c]
                            .flags
                            .intersects(Flags::AMBIENT | Flags::EXPORT | Flags::DEFAULT) =>
                    {
                        self.local(hir[c].name_pos, 6196, out)
                    }
                    Decl::Interface(id)
                        if !hir[id]
                            .flags
                            .intersects(Flags::AMBIENT | Flags::EXPORT | Flags::DEFAULT) =>
                    {
                        self.local(hir[id].name_pos, 6196, out)
                    }
                    Decl::Alias(a) if !hir[a].flags.contains(Flags::AMBIENT) => {
                        self.local(hir[a].name_pos, 6196, out)
                    }
                    Decl::Enum(e) if !hir[e].flags.contains(Flags::AMBIENT) => {
                        self.local(hir[e].name_pos, 6196, out)
                    }
                    Decl::Module(m) if !hir[m].flags.contains(Flags::AMBIENT) => {
                        self.local(hir[m].name_pos, 6133, out)
                    }
                    Decl::ImportEquals(id) => self.local(hir[id].name_pos, 6133, out),
                    _ => {}
                }
            }
        }
        for stmt in var_stmts {
            let StmtKind::Var(decls) = hir[stmt].kind else {
                continue;
            };
            if decls.iter().any(|d| hir[d].flags.contains(Flags::AMBIENT)) {
                continue;
            }
            // `reportUnusedVariables`
            if decls.len() > 1 && decls.iter().all(|d| self.is_unreferenced(hir[d].pat)) {
                if !(0..decls.len()).any(|i| self.variable_has_syntax_error(stmt, decls, i)) {
                    self.local(hir[stmt].pos, 6199, out);
                }
            } else {
                for (i, d) in decls.iter().enumerate() {
                    if !self.variable_has_syntax_error(stmt, decls, i) {
                        self.report_variable_declaration(hir[d].pat, false, out);
                    }
                }
            }
        }
        for f in fns {
            for p in hir[f].params.iter() {
                // `reportUnusedVariableDeclarations`: not a parameter property, and not a parameter named `this`.
                if !hir[p].flags.contains(Flags::PARAMETER_PROPERTY)
                    && !matches!(hir[hir[p].pat].kind, PatKind::Ident(known::this))
                    && !self.parameter_has_syntax_error(p)
                {
                    self.report_variable_declaration(hir[p].pat, true, out);
                }
            }
        }
        // `reportUnusedImports`
        imports.sort_unstable_by_key(|i| (i.0.0, i.1));
        let mut i = 0;
        while i < imports.len() {
            let id = imports[i].0;
            let end = i + imports[i..].iter().take_while(|x| x.0 == id).count();
            let import = &hir[id];
            let declared = usize::from(import.default.is_some())
                + usize::from(import.namespace.is_some())
                + import.named.len();
            let stmt = self.stmt_of_import[id.idx()];
            if stmt.is_some() && self.statement_has_syntax_error(stmt) {
                // The error may be in another part of the import than the one that is unused: node ends are not kept.
            } else if declared > 1 && declared == end - i && stmt.is_some() {
                self.local(hir[stmt].pos, 6192, out);
            } else {
                // What `import type` brings in are types. (Not so `import { type T }`.)
                for unused in &imports[i..end] {
                    let is_namespace =
                        import.namespace.is_some() && unused.1 == import.namespace_pos;
                    self.local(
                        unused.1,
                        if import.type_only && !is_namespace {
                            6196
                        } else {
                            6133
                        },
                        out,
                    );
                }
            }
            i = end;
        }
    }

    fn local(&self, start: u32, code: u32, out: &mut Vec<Diagnostic>) {
        if self.locals {
            out.push(Diagnostic { start, code });
        }
    }

    fn starts_with_underscore(&self, name: Atom) -> bool {
        name.is_some() && self.atoms.bytes(name).first() == Some(&b'_')
    }

    // `reportUnused` drops what is reported for a node that has `NodeFlagsThisNodeOrAnySubNodesHasError`. The parser flags the first
    // node it finishes after an error (`finishNodeWithEnd`), and the binder flags the ancestors. Node ends are not kept, so the
    // `*_has_syntax_error` functions take a node to reach as far as the start of what follows it.

    /// Whether a syntax error starts in `start..=end`.
    fn has_syntax_error_in(&self, start: u32, end: u32) -> bool {
        let first = self.syntax_errors.partition_point(|&at| at < start);
        self.syntax_errors.get(first).is_some_and(|&at| at <= end)
    }

    /// Whether a name in `pat` is missing (`createMissingIdentifier`).
    fn has_missing_name(&self, pat: PatId) -> bool {
        let hir = self.hir;
        match hir[pat].kind {
            PatKind::Missing => false,
            PatKind::Ident(name) => name == known::empty,
            PatKind::Object(props) => props.iter().any(|p| self.has_missing_name(hir[p].value)),
            PatKind::Array(elems) => elems.iter().any(|e| self.has_missing_name(hir[e].pat)),
        }
    }

    /// Where the node after the statement `s` starts, and whether that node is a statement. If nothing follows `s`, the position of
    /// the bracket that closes the block around it.
    fn start_of_next(&self, s: StmtId) -> (u32, bool) {
        let (hir, bound) = (self.hir, self.bound);
        let next_in = |list: IdList<StmtId>| hir.ids(list).skip_while(|&other| other != s).nth(1);
        let next = match bound.stmt_parent[s.idx()] {
            Parent::File => next_in(hir.body),
            Parent::Module(m) => next_in(hir[m].body),
            Parent::FnBody(f) => match hir[f].body {
                FnBody::Block(list) => next_in(list),
                _ => None,
            },
            Parent::Stmt(outer) if outer.is_some() => match hir[outer].kind {
                StmtKind::For {
                    init,
                    test,
                    update,
                    body,
                } if init == s => {
                    let next = if test.is_some() {
                        hir[test].pos
                    } else if update.is_some() {
                        hir[update].pos
                    } else {
                        hir[body].pos
                    };
                    return (next, false);
                }
                StmtKind::ForIn { left, expr, .. } | StmtKind::ForOf { left, expr, .. }
                    if left == s =>
                {
                    return (hir[expr].pos, false);
                }
                StmtKind::Block(list) => next_in(list),
                StmtKind::Switch { cases, .. } => cases.iter().find_map(|c| next_in(hir[c].body)),
                _ => None,
            },
            _ => None,
        };
        match next {
            Some(next) => (hir[next].pos, true),
            None => (closing_bracket_after(&hir.text, hir[s].pos as usize), false),
        }
    }

    fn statement_has_syntax_error(&self, stmt: StmtId) -> bool {
        if self.syntax_errors.is_empty() {
            return false;
        }
        let start = self.hir[stmt].pos;
        // An error at the start of the next statement belongs to that statement.
        let end = match self.start_of_next(stmt) {
            (next, true) => next.saturating_sub(1),
            (end, false) => end,
        };
        end >= start && self.has_syntax_error_in(start, end)
    }

    /// For a declaration that is a statement.
    fn declaration_has_syntax_error(&self, decl: Decl) -> bool {
        if self.syntax_errors.is_empty() {
            return false;
        }
        let (hir, bound) = (self.hir, self.bound);
        let find = |is_it: &dyn Fn(StmtKind) -> bool| {
            hir.stmts
                .iter()
                .position(|s| is_it(s.kind))
                .map_or(StmtId::NONE, |i| StmtId(i as u32))
        };
        let stmt = match decl {
            Decl::Fn(f) => match bound.fns[f.idx()].owner {
                FnOwner::Stmt(s) => s,
                _ => StmtId::NONE,
            },
            Decl::Class(c) => match bound.class_owner[c.idx()] {
                ClassOwner::Stmt(s) => s,
                ClassOwner::Expr(_) => StmtId::NONE,
            },
            Decl::Enum(e) => self.stmt_of_enum[e.idx()],
            Decl::Module(m) => self.stmt_of_module[m.idx()],
            Decl::Interface(id) => {
                find(&|kind: StmtKind| matches!(kind, StmtKind::Interface(other) if other == id))
            }
            Decl::Alias(id) => {
                find(&|kind: StmtKind| matches!(kind, StmtKind::TypeAlias(other) if other == id))
            }
            Decl::ImportEquals(id) => {
                find(&|kind: StmtKind| matches!(kind, StmtKind::ImportEquals(other) if other == id))
            }
            _ => StmtId::NONE,
        };
        stmt.is_some() && self.statement_has_syntax_error(stmt)
    }

    /// For declaration `i` of `decls`, the declarations of the variable statement `stmt`.
    fn variable_has_syntax_error(&self, stmt: StmtId, decls: Span<VarDeclId>, i: usize) -> bool {
        let hir = self.hir;
        let pat = hir[decls.at(i)].pat;
        if self.has_missing_name(pat) {
            return true;
        }
        if self.syntax_errors.is_empty() {
            return false;
        }
        let start = hir[pat].pos;
        if i + 1 < decls.len() {
            // A missing `,` is reported at the next declaration, and the first node finished after it is in there.
            let next = hir[hir[decls.at(i + 1)].pat].pos;
            return next > start && self.has_syntax_error_in(start, next - 1);
        }
        // A missing type or initializer is reported at the token after the declaration.
        self.has_syntax_error_in(start, self.start_of_next(stmt).0)
    }

    fn parameter_has_syntax_error(&self, p: ParamId) -> bool {
        let hir = self.hir;
        if self.has_missing_name(hir[p].pat) {
            return true;
        }
        let f = self.bound.param_fn[p.idx()];
        if self.syntax_errors.is_empty() || f.is_none() {
            return false;
        }
        let start = hir[p].pos;
        let next = ParamId(p.0 + 1);
        if hir[f].params.range().contains(&next.idx()) {
            return hir[next].pos > start && self.has_syntax_error_in(start, hir[next].pos - 1);
        }
        // The last one reaches as far as the `=>` of an arrow function or the `)` of the list.
        let end = if hir[f].kind == FnKind::Arrow {
            hir[f].anchor
        } else {
            closing_bracket_after(&hir.text, start as usize)
        };
        self.has_syntax_error_in(start, end)
    }

    fn member_has_syntax_error(&self, class: ClassId, m: MemberId) -> bool {
        if self.syntax_errors.is_empty() {
            return false;
        }
        let hir = self.hir;
        let start = hir[m].pos;
        let next = MemberId(m.0 + 1);
        if hir[class].members.range().contains(&next.idx()) {
            return hir[next].pos > start && self.has_syntax_error_in(start, hir[next].pos - 1);
        }
        self.has_syntax_error_in(start, closing_bracket_after(&hir.text, start as usize))
    }

    /// The variable declaration or the parameter `pat` is (part of) the name of.
    fn root_of(&self, mut pat: PatId) -> PatParent {
        loop {
            match self.bound.pat_parent[pat.idx()] {
                PatParent::Prop(parent, _) | PatParent::Elem(parent, _) => pat = parent,
                root => return root,
            }
        }
    }

    /// `reportUnusedVariableDeclarations`, for one of them.
    fn report_variable_declaration(
        &self,
        pat: PatId,
        is_parameter: bool,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir;
        let wanted = if is_parameter {
            self.parameters
        } else {
            self.locals
        };
        let elements: Vec<PatId> = match hir[pat].kind {
            PatKind::Missing => return,
            PatKind::Ident(_) => {
                if wanted && self.is_unreferenced(pat) {
                    out.push(Diagnostic {
                        start: hir[pat].pos,
                        code: 6133,
                    });
                }
                return;
            }
            PatKind::Object(props) => props.iter().map(|p| hir[p].value).collect(),
            PatKind::Array(elems) => elems.iter().map(|e| hir[e].pat).collect(),
        };
        // `reportUnusedBindingElements`
        if elements.len() > 1 && elements.iter().all(|&e| self.is_unreferenced(e)) {
            if wanted {
                out.push(Diagnostic {
                    start: hir[pat].pos,
                    code: 6198,
                });
            }
        } else {
            for e in elements {
                self.report_variable_declaration(e, is_parameter, out);
            }
        }
    }

    /// `isUnreferencedVariableDeclaration`
    fn is_unreferenced(&self, pat: PatId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let name = match hir[pat].kind {
            PatKind::Missing => return true,
            PatKind::Object(props) => {
                return props.iter().all(|p| self.is_unreferenced(hir[p].value));
            }
            PatKind::Array(elems) => return elems.iter().all(|e| self.is_unreferenced(hir[e].pat)),
            PatKind::Ident(name) => name,
        };
        let symbol = bound.pat_symbol[pat.idx()];
        if symbol.is_some() && self.referenced[symbol.idx()] & VALUE != 0 {
            return false;
        }
        let excuses_underscore = match bound.pat_parent[pat.idx()] {
            PatParent::Param(_) => true,
            PatParent::Var(d) => {
                let stmt = bound.var_stmt[d.idx()];
                let heads_a_loop = stmt.is_some()
                    && matches!(bound.stmt_parent[stmt.idx()], Parent::Stmt(outer) if outer.is_some()
                        && matches!(hir[outer].kind, StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == stmt));
                heads_a_loop || matches!(hir[d].kind, VarKind::Using | VarKind::AwaitUsing)
            }
            PatParent::Prop(parent, p) => {
                // In `{ a, ...b }`, `a` is there to be left out of `b`.
                if let PatKind::Object(props) = hir[parent].kind
                    && let Some(last) = props.iter().last()
                    && last != p
                    && hir[last].is_rest
                {
                    return false;
                }
                // Only what is written after the name of a property had a choice of name: not `{ _a }`, not `{ ..._a }`.
                !hir[p].is_rest && hir[p].pos != hir[pat].pos
            }
            PatParent::Elem(..) => true,
            PatParent::None => false,
        };
        !(excuses_underscore && self.starts_with_underscore(name))
    }

    /// `checkUnusedTypeParameters`
    fn report_type_parameters(&self, params: Span<TypeParamId>, out: &mut Vec<Diagnostic>) {
        // `reportUnused` is given the declaration they belong to, which contains the syntax error of a missing name.
        if params.iter().any(|p| self.hir[p].name == known::empty) {
            return;
        }
        if params.len() > 1
            && params
                .iter()
                .all(|p| self.is_unreferenced_type_parameter(p))
        {
            // `rangeOfTypeParameters`: from the `<`.
            let first = self.start_of_type_parameter(params.at(0));
            let open = self
                .hir
                .text
                .get(..first as usize)
                .and_then(|before| before.iter().rposition(|&c| c == b'<'));
            out.push(Diagnostic {
                start: open.map_or(first.saturating_sub(1), |at| at as u32),
                code: 6205,
            });
            return;
        }
        for p in params.iter() {
            if self.is_unreferenced_type_parameter(p) {
                out.push(Diagnostic {
                    start: self.start_of_type_parameter(p),
                    code: 6196,
                });
            }
        }
    }

    /// Where the type parameter `p` starts, `const`, `in` and `out` included.
    fn start_of_type_parameter(&self, p: TypeParamId) -> u32 {
        const MODIFIERS: [&[u8]; 3] = [b"const", b"in", b"out"];
        let hir = self.hir;
        let mut start = hir[p].pos as usize;
        if hir[p]
            .flags
            .intersects(Flags::CONST | Flags::IN | Flags::OUT)
        {
            while let Some(before) = hir.text.get(..start).map(|text| text.trim_ascii_end())
                && let Some(modifier) = MODIFIERS
                    .into_iter()
                    .find(|modifier| before.ends_with(modifier))
            {
                start = before.len() - modifier.len();
            }
        }
        start as u32
    }

    fn is_unreferenced_type_parameter(&self, p: TypeParamId) -> bool {
        let symbol = self.bound.type_param_symbol[p.idx()];
        symbol.is_some()
            && self.referenced[symbol.idx()] & TYPE == 0
            && !self.starts_with_underscore(self.hir[p].name)
    }

    /// `checkUnusedClassMembers`
    fn report_class_members(&self, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir, self.bound);
        if self.reads_unknown_members {
            return;
        }
        for (i, member) in hir.members.iter().enumerate() {
            let m = MemberId(i as u32);
            let MemberOwner::Class(class) = bound.member_owner[i] else {
                continue;
            };
            if hir[class].flags.contains(Flags::AMBIENT) || member.flags.contains(Flags::AMBIENT) {
                continue;
            }
            match member.kind {
                MemberKind::Property
                | MemberKind::Method
                | MemberKind::Getter
                | MemberKind::Setter => {
                    if !(member.flags.contains(Flags::PRIVATE)
                        || matches!(member.key, PropKey::Private(_)))
                    {
                        continue;
                    }
                    let same_name = |other: MemberId| {
                        let o = &hir[other];
                        o.flags.contains(Flags::STATIC) == member.flags.contains(Flags::STATIC)
                            && match (o.key, member.key) {
                                (PropKey::Name(a), PropKey::Name(b))
                                | (PropKey::Private(a), PropKey::Private(b)) => a == b,
                                _ => false,
                            }
                    };
                    // It would have been said of the getter.
                    if member.kind == MemberKind::Setter
                        && hir[class]
                            .members
                            .iter()
                            .any(|o| hir[o].kind == MemberKind::Getter && same_name(o))
                    {
                        continue;
                    }
                    if !hir[class]
                        .members
                        .iter()
                        .any(|o| same_name(o) && self.read_members.contains(&o))
                        && !self.read_members.contains(&m)
                        && !self.member_has_syntax_error(class, m)
                    {
                        out.push(Diagnostic {
                            start: member.pos,
                            code: 6133,
                        });
                    }
                }
                MemberKind::Constructor => {
                    for p in hir[member.func].params.iter() {
                        // The property, that is. The parameter may well be.
                        if hir[p].flags.contains(Flags::PRIVATE)
                            && !self.read_parameter_properties.contains(&p)
                            && !self.parameter_has_syntax_error(p)
                        {
                            out.push(Diagnostic {
                                start: hir[hir[p].pat].pos,
                                code: 6138,
                            });
                        }
                    }
                }
                _ => {}
            }
        }
    }
}
