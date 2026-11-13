use bun_sema::atom::{Interner, known};
use bun_sema::bind::{Binding, Bound, Decl, Parent, SymbolId};
use bun_sema::hir::{
    BinOp, Call, CallId, Chain, ExportSpecId, ExprId, ExprKind, File, FileBuilder, Flags, FnBody,
    FnKind, Func, ListAt, ParamId, PatKind, PropKey, PropKind, Span, StmtId, StmtKind, TypeNodeId,
    VarDecl, VarDeclId, VarKind,
};
use bun_sema::resolve::TreeChange;
use bun_sema::session::Arena;
use rustc_hash::FxHashMap;

use crate::load::react_compiler::module_items::finish_file;

struct Prototype {
    statement: StmtId,
    declaration: VarDeclId,
    value: ExprId,
    above: Option<SymbolId>,
    mentions: Vec<ExprId>,
    created: Vec<(ExprId, CallId)>,
}

type Prototypes = FxHashMap<SymbolId, Prototype>;

struct Finder<'f, 's> {
    atoms: &'f Interner<'s>,
    hir: &'f File<'s>,
    bound: &'f Bound<'s>,
}

impl Finder<'_, '_> {
    fn is_literal_of_methods(&self, literal: ExprId) -> bool {
        let hir = self.hir;
        let ExprKind::Object(properties) = hir[literal].kind else {
            return false;
        };
        let is_function = |value: ExprId| matches!(hir[value].kind, ExprKind::Fn(_));
        properties.iter().any(|id| is_function(hir[id].value))
            && properties.iter().all(|id| {
                let property = hir[id];
                let is_constant = matches!(
                    hir[property.value].kind,
                    ExprKind::Null
                        | ExprKind::True
                        | ExprKind::False
                        | ExprKind::Number(_)
                        | ExprKind::String(_)
                );
                matches!(property.kind, PropKind::Method | PropKind::Init)
                    && matches!(property.key, PropKey::Name(name) if name != known::__proto__)
                    && (is_constant || is_function(property.value))
            })
    }

    fn find_parent(&self, call: CallId) -> Option<(SymbolId, ExprId)> {
        let hir = self.hir;
        let Call {
            callee,
            args,
            chain,
            ..
        } = hir[call];
        let ExprKind::Dot {
            obj: object, name, ..
        } = hir[callee].kind
        else {
            return None;
        };
        let ExprKind::Ident(holder) = hir[object].kind else {
            return None;
        };
        if hir.is_written_in_brackets(callee)
            || chain != Chain::No
            || args.len != 1
            || self.atoms.bytes(name) != b"create"
            || self.atoms.bytes(holder) != b"Object"
            || self.bound.binding(object) != Binding::Free
        {
            return None;
        }
        let parent = hir.ids(args).next()?;
        match (hir[parent].kind, self.bound.binding(parent)) {
            (ExprKind::Ident(_), Binding::Symbol(symbol)) => Some((symbol, parent)),
            _ => None,
        }
    }

    fn find_prototypes(&self) -> Prototypes {
        let (hir, bound) = (self.hir, self.bound);
        let mut prototypes = FxHashMap::default();
        for statement in hir.ids(hir.body) {
            let StmtKind::Var(declarations) = hir[statement].kind else {
                continue;
            };
            for declaration in declarations.iter() {
                let VarDecl {
                    pat, init, kind, ..
                } = hir[declaration];
                if kind != VarKind::Const
                    || init == ExprId::NONE
                    || !matches!(hir[pat].kind, PatKind::Ident(_))
                {
                    continue;
                }
                let above = match hir[init].kind {
                    ExprKind::Call(call) => self.find_parent(call).map(|it| it.0),
                    _ => None,
                };
                if above.is_none() && !self.is_literal_of_methods(init) {
                    continue;
                }
                let symbol = bound.declared_symbol(Decl::Var(pat));
                if bound.is_stable_binding(symbol)
                    && !bound.is_exported_by_container(Decl::Var(pat))
                {
                    prototypes.insert(
                        symbol,
                        Prototype {
                            statement,
                            declaration,
                            value: init,
                            above,
                            mentions: Vec::new(),
                            created: Vec::new(),
                        },
                    );
                }
            }
        }
        prototypes
    }

    fn runs_once(&self, expression: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let mut parent = bound.parent_of_expr(expression);
        loop {
            parent = match parent {
                Parent::File => return true,
                Parent::Expr(above) => bound.parent_of_expr(above),
                Parent::VarInit(declaration) => match bound.var_stmt[declaration.idx()].some() {
                    Some(statement) => bound.parent_of_stmt(statement),
                    None => return false,
                },
                Parent::Prop(property) => match bound.prop_owner[property.idx()].some() {
                    Some(owner) if hir[property].kind == PropKind::Init => {
                        bound.parent_of_expr(owner)
                    }
                    _ => return false,
                },
                Parent::Stmt(statement) => match hir[statement].kind {
                    StmtKind::Expr(_)
                    | StmtKind::Var(_)
                    | StmtKind::Block(_)
                    | StmtKind::If { .. }
                    | StmtKind::Try { .. } => bound.parent_of_stmt(statement),
                    _ => return false,
                },
                _ => return false,
            };
        }
    }

    fn may_read_prototype(&self, mention: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        if bound.is_store_target(mention) {
            return false;
        }
        let parent = bound.parent_of_expr(mention);
        if let Parent::Prop(property) = parent
            && hir[property].kind != PropKind::Init
        {
            return false;
        }
        if self.runs_once(mention) {
            return true;
        }
        let Parent::Expr(around) = parent else {
            return false;
        };
        match hir[around].kind {
            ExprKind::Binary {
                op: BinOp::EqEqEq | BinOp::NotEqEq,
                ..
            } => true,
            ExprKind::Dot { obj, name, .. } if obj == mention => {
                let calls = |name| matches!(self.atoms.bytes(name), b"call" | b"apply");
                self.atoms.bytes(name) == b"isPrototypeOf"
                    || matches!(bound.parent_of_expr(around), Parent::Expr(method)
                        if matches!(hir[method].kind, ExprKind::Dot { obj, name, .. } if obj == around && calls(name)))
            }
            _ => false,
        }
    }

    fn find_created(&self) -> Prototypes {
        let (hir, bound) = (self.hir, self.bound);
        let mut prototypes = self.find_prototypes();
        if prototypes.is_empty() {
            return prototypes;
        }
        let mut parents = Vec::new();
        for (index, expression) in hir.exprs.iter().enumerate() {
            let id = ExprId(index as u32);
            match expression.kind {
                ExprKind::Ident(_) => {
                    if let Binding::Symbol(symbol) = bound.binding(id)
                        && let Some(prototype) = prototypes.get_mut(&symbol)
                    {
                        prototype.mentions.push(id);
                    }
                }
                ExprKind::Call(call) => {
                    if let Some((symbol, parent)) = self.find_parent(call)
                        && let Some(prototype) = prototypes.get_mut(&symbol)
                    {
                        prototype.created.push((id, call));
                        parents.push(parent);
                    }
                }
                _ => {}
            }
        }
        for spec in (0..hir.export_specs.len() as u32).map(ExportSpecId) {
            if let Binding::Symbol(symbol) = bound.exported_binding(spec) {
                prototypes.remove(&symbol);
            }
        }
        parents.sort_unstable_by_key(|parent| parent.0);
        prototypes.retain(|_, prototype| {
            let mentions = &mut prototype.mentions;
            mentions.retain(|mention| {
                parents
                    .binary_search_by_key(&mention.0, |parent| parent.0)
                    .is_err()
            });
            !prototype.created.is_empty()
                && mentions
                    .iter()
                    .all(|&mention| self.may_read_prototype(mention))
        });
        loop {
            let orphan = prototypes.iter().find_map(|(&symbol, prototype)| {
                let above = prototype.above?;
                (!prototypes.contains_key(&above)).then_some(symbol)
            });
            match orphan {
                Some(symbol) => prototypes.remove(&symbol),
                None => return prototypes,
            };
        }
    }
}

pub(crate) fn is_created_below(hir: &File<'_>, expression: ExprId) -> bool {
    let written = hir[expression];
    matches!(written.kind, ExprKind::New(_))
        && hir.text[written.pos as usize..].starts_with(b"Object")
}

pub(crate) fn written_name_of_prototype(hir: &File<'_>, expression: ExprId) -> Option<ExprId> {
    let read = hir[expression];
    match read.kind {
        ExprKind::Dot { obj, name, .. } if name == known::prototype => {
            let written = hir[obj];
            (written.pos == read.pos && written.end == read.end).then_some(obj)
        }
        _ => None,
    }
}

pub(crate) fn construct_objects_created_below<'s>(
    arena: &'s Arena,
    atoms: &Interner<'s>,
    hir: &mut File<'s>,
    bound: &Bound<'s>,
) -> TreeChange {
    if !hir.is_js
        || hir.has_errors
        || hir.ran_out_of_stack
        || !hir.with_bodies.is_empty()
        || !hir.known_evaluations.is_empty()
        || !bound.runtime.is_computed()
        || !bound.runtime.eval_scopes().is_empty()
    {
        return TreeChange::Unchanged;
    }
    let finder = Finder { atoms, hir, bound };
    let mut prototypes: Vec<Prototype> = finder.find_created().into_values().collect();
    if prototypes.is_empty() {
        return TreeChange::Unchanged;
    }
    prototypes.sort_unstable_by_key(|it| it.declaration.0);
    let body: Vec<StmtId> = hir.ids(hir.body).collect();
    let mut file = FileBuilder::from_file(hir);
    let mut statements = Vec::with_capacity(body.len() + prototypes.len());
    for statement in body {
        statements.push(statement);
        let StmtKind::Var(declarations) = file[statement].kind else {
            continue;
        };
        if !prototypes.iter().any(|it| it.statement == statement) {
            continue;
        }
        let mut written: Vec<VarDecl> = Vec::new();
        let mut is_first = true;
        for declaration in declarations.iter() {
            let held = file[declaration];
            written.push(held);
            let Some(prototype) = prototypes.iter().find(|it| it.declaration == declaration) else {
                continue;
            };
            let PatKind::Ident(name) = file[held.pat].kind else {
                unreachable!("a prototype is found under a name");
            };
            let (at, value) = (file[held.pat].end, file[prototype.value]);
            let no_statements = file.list::<StmtId>(&[]);
            let function = file.add_fn(Func {
                kind: FnKind::Expr,
                flags: Flags::empty(),
                name: bun_sema::atom::Atom::NONE,
                name_pos: at,
                type_params: Span::EMPTY,
                params: Span::EMPTY,
                this_param: ParamId::NONE,
                ret: TypeNodeId::NONE,
                body: FnBody::Block(no_statements),
                anchor: at,
                start: at,
                text_start: at,
                is_strict: true,
                is_strict_by_syntax: false,
            });
            let function = file.expr(ExprKind::Fn(function), at, at);
            if let Some(declared) = written.last_mut() {
                declared.init = function;
                declared.loc.end = at;
            }
            let declared = StmtKind::Var(file.add_var_decls(&written));
            written.clear();
            if is_first {
                file.set_stmt_kind(statement, declared);
            } else {
                statements.push(file.stmt(declared, at));
            }
            is_first = false;
            let object = file.expr(ExprKind::Ident(name), value.pos, value.pos);
            let target = file.dot(
                (object, Chain::No),
                (known::prototype, value.pos),
                value.pos,
            );
            let target = file.expr(target, value.pos, value.pos);
            let assignment = ExprKind::Assign {
                op: None,
                target,
                value: prototype.value,
            };
            let assignment = file.expr(assignment, value.pos, value.end);
            statements.push(file.stmt(StmtKind::Expr(assignment), value.pos));
        }
        if !written.is_empty() {
            let at = file[written[0].pat].pos;
            let declared = StmtKind::Var(file.add_var_decls(&written));
            statements.push(file.stmt(declared, at));
        }
    }
    for prototype in &prototypes {
        for &(expression, call) in &prototype.created {
            let written = file[call];
            let parent = file.ids[written.args.start as usize];
            let no_arguments = file.list::<ExprId>(&[]);
            let construction = file.add_call(Call {
                callee: ExprId(parent),
                args: no_arguments,
                type_args: ListAt::EMPTY,
                ..written
            });
            file[expression].kind = ExprKind::New(construction);
        }
        for &mention in &prototype.mentions {
            let written = file[mention];
            let object = file.expr(written.kind, written.pos, written.end);
            let names = (known::prototype, written.pos);
            file[mention].kind = file.dot((object, Chain::No), names, written.end);
        }
    }
    file.body = file.list(&statements);
    *hir = finish_file(file, arena, atoms);
    TreeChange::Changed
}
