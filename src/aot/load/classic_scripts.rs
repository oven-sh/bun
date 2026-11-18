//! A classic script of a page is a CommonJS file with two exports: `names`, a script that declares what it declares and that the
//! engine evaluates, and `run`, its code, in which those names are free. `run` takes an object: a store to it initializes a binding.

use core::cmp::Reverse;

use bun_sema::atom::{Atom, Interner, NAME_IN_GLOBAL_SCOPE, known};
use bun_sema::bind::{Binding, Bound, ScopeId};
use bun_sema::hir::{
    BinOp, CLASSIC_SCRIPT_START, Chain, ExprId, ExprKind, File, FileBuilder, Flags, FnBody, FnId,
    FnKind, IdList, NameKind, PatId, PatKind, Prop, PropKey, PropKind, SpecifierKind, StmtId,
    StmtKind, TextRange, TypeNodeId, UnOp, VarDecl, VarDeclId, VarKind,
};
use bun_sema::resolve::{TransformRequest, TreeChange};
use bun_sema::session::Arena;
use rustc_hash::FxHashSet;

use crate::builtins::table;
use crate::load::known_evaluations::{
    end_of_body, is_callee_of_direct_eval, is_within, start_of_code,
};
use crate::load::react_compiler::module_items::finish_file;

const NAME_OF_BINDINGS: &[u8] = b"%bindings";
/// What the build would take for Bun's.
const NAMES_LEFT_ALONE: [&[u8]; 9] = [
    b"require",
    b"module",
    b"exports",
    b"__filename",
    b"__dirname",
    b"process",
    b"global",
    b"Bun",
    b"Worker",
];

/// Nothing but `names`, for [`set_names`].
pub(crate) const LEFT_TO_ENGINE: &[u8] = b"this.names=\"\"";

pub(crate) fn set_names(hir: &mut File<'_>, names: Atom) {
    if let Some(last) = hir.ids(hir.body).last()
        && let StmtKind::Expr(assignment) = hir[last].kind
        && let ExprKind::Assign { value, .. } = hir[assignment].kind
    {
        hir[value].kind = ExprKind::String(names);
    }
}

/// The function around the text would change what it means.
pub(crate) fn is_left_to_engine(hir: &File<'_>) -> bool {
    let script = hir.function_assigned_first();
    let Some(script) = script.filter(|_| hir.ids(hir.body).count() == 2) else {
        return true;
    };
    let ranges_of_functions = |counts_arrows: bool| {
        let functions = (0..hir.fns.len() as u32).map(FnId);
        let mut ranges: Vec<(u32, u32)> = functions
            .filter(|&it| it != script && (counts_arrows || hir[it].kind != FnKind::Arrow))
            .filter_map(|it| Some((start_of_code(hir, it), end_of_body(hir, it)?)))
            .collect();
        ranges.sort_unstable_by_key(|it| (it.0, Reverse(it.1)));
        ranges.dedup_by(|inner, outer| inner.1 <= outer.1);
        ranges
    };
    let (all, without_arrows) = (ranges_of_functions(true), ranges_of_functions(false));
    let sees_function = |kind: ExprKind| match kind {
        ExprKind::Call(call) => is_callee_of_direct_eval(hir[hir[call].callee].kind),
        kind => matches!(kind, ExprKind::NewTarget(_)),
    };
    let mut statements = hir.stmts.iter();
    (hir.exprs.iter()).any(|it| matches!(it.kind, ExprKind::ImportMeta))
        || statements.any(|it| matches!(it.kind, StmtKind::Return(_)) && !is_within(&all, it.start))
        || (hir.exprs.iter())
            .any(|it| sees_function(it.kind) && !is_within(&without_arrows, it.pos))
}

struct Rewrite<'a, 's> {
    file: FileBuilder,
    atoms: &'a Interner<'s>,
    bindings: Atom,
    left_alone: Vec<Atom>,
    /// Those in blocks that are also variables of the script.
    hoisted: FxHashSet<FnId>,
    is_strict: bool,
    names: Vec<u8>,
    variables: FxHashSet<Atom>,
    lexical_builtins: Vec<Atom>,
    head: Vec<StmtId>,
}

impl Rewrite<'_, '_> {
    fn in_global_scope(&self, name: Atom) -> Atom {
        (self.atoms).intern(&[NAME_IN_GLOBAL_SCOPE, self.atoms.bytes(name)].concat())
    }

    fn declare(&mut self, before: &[u8], name: Atom, after: &[u8]) {
        for part in [before, self.atoms.bytes(name), after] {
            self.names.extend_from_slice(part);
        }
    }

    fn global(&mut self, name: Atom, pos: u32, end: u32) -> ExprId {
        let name = match self.left_alone.contains(&name) {
            true => self.in_global_scope(name),
            false => name,
        };
        self.file.expr(ExprKind::Ident(name), pos, end)
    }

    fn binding(&mut self, key: Atom, pos: u32, end: u32) -> ExprId {
        let obj = self.file.expr(ExprKind::Ident(self.bindings), pos, pos);
        let index = self.file.expr(ExprKind::String(key), pos, end);
        let chain = Chain::No;
        (self.file).expr(ExprKind::Index { obj, index, chain }, pos, end)
    }

    fn assign(&mut self, target: ExprId, value: ExprId) -> ExprId {
        let (pos, end) = (self.file[target].pos, self.file[value].end);
        let op = None;
        (self.file).expr(ExprKind::Assign { op, target, value }, pos, end)
    }

    fn binary(&mut self, op: BinOp, left: ExprId, right: ExprId) -> ExprId {
        let (pos, end) = (self.file[left].pos, self.file[right].end);
        (self.file).expr(ExprKind::Binary { op, left, right }, pos, end)
    }

    fn zero(&mut self, pos: u32) -> ExprId {
        let number = self.file.number(0.0);
        self.file.expr(ExprKind::Number(number), pos, pos)
    }

    fn statement(&mut self, kind: StmtKind, like: StmtId) -> StmtId {
        let statement = self.file.stmt(kind, self.file[like].start);
        self.file[statement].loc = self.file[like].loc;
        statement
    }

    fn lexical(&mut self, name: Atom, kind: VarKind, pos: u32, end: u32) -> ExprId {
        match kind {
            VarKind::Const => self.declare(b"const ", name, b"=0;"),
            _ => self.declare(b"let ", name, b";"),
        }
        let known = table::find_name(self.atoms.bytes(name));
        if known.and_then(table::global).is_some() {
            self.lexical_builtins.push(name);
        }
        self.binding(name, pos, end)
    }

    /// A store to a member names no function.
    fn named(&mut self, value: ExprId, pattern: PatId, kind: VarKind) -> ExprId {
        let is_anonymous = match self.file[value].kind {
            ExprKind::Fn(function) => self.file[function].name.is_none(),
            ExprKind::Class(class) => self.file[class].name.is_none(),
            _ => false,
        };
        let PatKind::Ident(name) = self.file[pattern].kind else {
            return value;
        };
        if !is_anonymous || kind == VarKind::Var || name == known::__proto__ {
            return value;
        }
        let (pos, end) = (self.file[value].pos, self.file[value].end);
        let properties = self.file.add_props(&[Prop {
            kind: PropKind::Init,
            key: PropKey::Name(name),
            name_kind: NameKind::Identifier,
            value,
            pos,
            start: pos,
            end,
            postfix_token: 0,
        }]);
        let object = self.file.expr(ExprKind::Object(properties), pos, end);
        let member = self.file.dot((object, Chain::No), (name, end), end);
        self.file.expr(member, pos, end)
    }

    fn element(&mut self, pattern: PatId, default: ExprId, kind: VarKind) -> ExprId {
        if default.is_none() {
            return self.target(pattern, kind);
        }
        let default = self.named(default, pattern, kind);
        let target = self.target(pattern, kind);
        self.assign(target, default)
    }

    fn target(&mut self, pattern: PatId, kind: VarKind) -> ExprId {
        let (pos, end) = (self.file[pattern].pos, self.file[pattern].end);
        let written = std::mem::replace(&mut self.file[pattern].kind, PatKind::Missing);
        let target = match written {
            PatKind::Missing => ExprKind::Missing,
            PatKind::Ident(name) if kind != VarKind::Var => {
                return self.lexical(name, kind, pos, end);
            }
            PatKind::Ident(name) => {
                if self.variables.insert(name) {
                    self.declare(b"var ", name, b";");
                }
                return self.global(name, pos, end);
            }
            PatKind::Array(elements) => {
                let mut targets = Vec::with_capacity(elements.len());
                for id in elements.iter() {
                    let element = self.file[id];
                    self.file[id].default = ExprId::NONE;
                    let target = self.element(element.pat, element.default, kind);
                    targets.push(match element.is_rest {
                        true => {
                            (self.file).expr(ExprKind::Spread(target), element.start, element.end)
                        }
                        false => target,
                    });
                }
                ExprKind::Array(self.file.list(&targets))
            }
            PatKind::Object(properties) => {
                let mut targets = Vec::with_capacity(properties.len());
                for id in properties.iter() {
                    let property = self.file[id];
                    (self.file[id].default, self.file[id].key) = (ExprId::NONE, PropKey::None);
                    let (kind_of_property, key) = match property.is_rest {
                        true => (PropKind::Spread, PropKey::None),
                        false => (PropKind::Init, property.key),
                    };
                    targets.push(Prop {
                        kind: kind_of_property,
                        key,
                        name_kind: property.name_kind,
                        value: self.element(property.value, property.default, kind),
                        pos: property.key_pos,
                        start: property.pos,
                        end: property.end,
                        postfix_token: 0,
                    });
                }
                ExprKind::Object(self.file.add_props(&targets))
            }
        };
        self.file.expr(target, pos, end)
    }

    /// `NONE` if there is nothing to store.
    fn initialization(&mut self, id: VarDeclId) -> ExprId {
        let VarDecl {
            pat, init, kind, ..
        } = self.file[id];
        self.file[id].init = ExprId::NONE;
        let value = match (init.some(), kind) {
            (Some(init), _) => self.named(init, pat, kind),
            (None, VarKind::Var) => ExprId::NONE,
            (None, _) => {
                let end = self.file[pat].end;
                let (op, operand) = (UnOp::Void, self.zero(end));
                self.file.expr(ExprKind::Unary { op, operand }, end, end)
            }
        };
        let target = self.target(pat, kind);
        match value.some() {
            Some(value) => self.assign(target, value),
            None => ExprId::NONE,
        }
    }

    /// `for (var a in b)`. Returns what to evaluate in place of `b`.
    fn visit_head_of_loop(&mut self, left: StmtId, object: ExprId) -> ExprId {
        let StmtKind::Var(declarations) = self.file[left].kind else {
            return object;
        };
        let is_var = |it: &VarDeclId| self.file[*it].kind == VarKind::Var;
        let Some(id) = declarations.iter().next().filter(is_var) else {
            return object;
        };
        let init = std::mem::replace(&mut self.file[id].init, ExprId::NONE);
        let target = self.target(self.file[id].pat, VarKind::Var);
        self.file[left].kind = StmtKind::Expr(target);
        if init.is_none() {
            return object;
        }
        let written = self.file[target];
        let again = self.file.expr(written.kind, written.pos, written.end);
        let store = self.assign(again, init);
        self.binary(BinOp::Comma, store, object)
    }

    /// Adds the names of the functions that sloppy code would see outside of the block.
    fn visit_block(&mut self, body: IdList<StmtId>, functions: &mut Vec<Atom>) -> IdList<StmtId> {
        let written: Vec<StmtId> = self.file.ids(body).collect();
        let mut statements = Vec::with_capacity(written.len());
        for &statement in &written {
            self.visit(statement, false);
            statements.push(statement);
            let StmtKind::Fn(function) = self.file[statement].kind else {
                continue;
            };
            let name = self.file[function].name;
            let flags = self.file[function].flags;
            if self.is_strict || flags.intersects(Flags::ASYNC | Flags::GENERATOR) {
                continue;
            }
            if !functions.contains(&name) {
                functions.push(name);
            }
            if self.hoisted.contains(&function) {
                self.declare(b"{function ", name, b"(){}}");
                let end = self.file[statement].loc.end;
                let key = self.atoms.intern(&[b" ", self.atoms.bytes(name)].concat());
                let target = self.binding(key, end, end);
                let value = self.file.expr(ExprKind::Ident(name), end, end);
                let store = self.assign(target, value);
                statements.push(self.file.stmt(StmtKind::Expr(store), end));
            }
        }
        match statements.len() == written.len() {
            true => body,
            false => self.file.list(&statements),
        }
    }

    /// A `let` around the block keeps its functions from being variables of `run`.
    fn confine(&mut self, statement: StmtId, kind: StmtKind, functions: &[Atom]) {
        if functions.is_empty() {
            self.file[statement].kind = kind;
            return;
        }
        let pos = self.file[statement].start;
        let declarations: Vec<VarDecl> = (functions.iter())
            .map(|&name| VarDecl {
                pat: self.file.pat(PatKind::Ident(name), pos, pos),
                ty: TypeNodeId::NONE,
                init: ExprId::NONE,
                kind: VarKind::Let,
                flags: Flags::empty(),
                loc: TextRange { pos, end: pos },
            })
            .collect();
        let declarations = self.file.add_var_decls(&declarations);
        let declarations = self.file.stmt(StmtKind::Var(declarations), pos);
        let inner = self.statement(kind, statement);
        self.file[statement].kind = StmtKind::Block(self.file.list(&[declarations, inner]));
    }

    fn visit_branch(&mut self, branch: StmtId) {
        if branch.is_some()
            && let kind @ StmtKind::Fn(_) = self.file[branch].kind
        {
            let function = self.statement(kind, branch);
            self.file[branch].kind = StmtKind::Block(self.file.list(&[function]));
        }
        self.visit(branch, false);
    }

    fn visit(&mut self, statement: StmtId, is_at_top: bool) {
        if statement.is_none() {
            return;
        }
        match self.file[statement].kind {
            StmtKind::Var(declarations) => {
                let mut all = ExprId::NONE;
                for id in declarations.iter() {
                    match self.file[id].kind {
                        VarKind::Var => {}
                        VarKind::Let | VarKind::Const if is_at_top => {}
                        _ => return,
                    }
                    let next = self.initialization(id);
                    all = match (all.some(), next.some()) {
                        (Some(all), Some(next)) => self.binary(BinOp::Comma, all, next),
                        (Some(one), None) | (None, Some(one)) => one,
                        (None, None) => ExprId::NONE,
                    };
                }
                self.file[statement].kind = all.some().map_or(StmtKind::Empty, StmtKind::Expr);
            }
            StmtKind::Fn(function) if is_at_top => {
                let written = self.file[function];
                self.declare(b"function ", written.name, b"(){}");
                (self.file[function].kind, self.file[function].name) = (FnKind::Expr, Atom::NONE);
                let end = self.file[statement].loc.end;
                let value = (self.file).expr(ExprKind::Fn(function), written.start, end);
                let target = self.global(written.name, written.name_pos, written.name_pos);
                let store = self.assign(target, value);
                let store = self.file.stmt(StmtKind::Expr(store), written.start);
                self.head.push(store);
                self.file[statement].kind = StmtKind::Empty;
            }
            StmtKind::Class(class) if is_at_top => {
                let written = self.file[class];
                let end = self.file[statement].loc.end;
                let value = self.file.expr(ExprKind::Class(class), written.start, end);
                let pos = written.name_pos;
                let target = self.lexical(written.name, VarKind::Let, pos, pos);
                self.file[statement].kind = StmtKind::Expr(self.assign(target, value));
            }
            StmtKind::Labeled { body, .. } => self.visit(body, is_at_top),
            StmtKind::If { yes, no, .. } => {
                self.visit_branch(yes);
                self.visit_branch(no);
            }
            StmtKind::For { init, body, .. } => {
                self.visit(init, false);
                if init.is_some()
                    && matches!(self.file[init].kind, StmtKind::Empty)
                    && let StmtKind::For { init, .. } = &mut self.file[statement].kind
                {
                    *init = StmtId::NONE;
                }
                self.visit(body, false);
            }
            StmtKind::ForIn { left, expr, body } => {
                let expr = self.visit_head_of_loop(left, expr);
                self.file[statement].kind = StmtKind::ForIn { left, expr, body };
                self.visit(body, false);
            }
            StmtKind::ForOf {
                left, expr, body, ..
            } => {
                self.visit_head_of_loop(left, expr);
                self.visit(body, false);
            }
            StmtKind::While { body, .. }
            | StmtKind::DoWhile { body, .. }
            | StmtKind::With { body, .. } => self.visit(body, false),
            StmtKind::Block(body) => {
                let mut functions = Vec::new();
                let body = self.visit_block(body, &mut functions);
                self.confine(statement, StmtKind::Block(body), &functions);
            }
            kind @ StmtKind::Switch { cases, .. } => {
                let mut functions = Vec::new();
                for case in cases.iter() {
                    self.file[case].body = self.visit_block(self.file[case].body, &mut functions);
                }
                self.confine(statement, kind, &functions);
            }
            StmtKind::Try {
                block,
                handler,
                finalizer,
                ..
            } => {
                for part in [block, handler, finalizer] {
                    self.visit(part, false);
                }
            }
            _ => {}
        }
    }

    fn rename(&mut self, bound: &Bound<'_>, top: ScopeId, count: usize) {
        for id in (0..count as u32).map(ExprId) {
            let ExprKind::Ident(name) = self.file[id].kind else {
                continue;
            };
            let is_left_alone = self.left_alone.contains(&name);
            if !is_left_alone && !self.lexical_builtins.contains(&name) {
                continue;
            }
            let is_global = match bound.binding(id) {
                Binding::Symbol(symbol) => bound.symbol_scope(symbol) == top,
                Binding::Free | Binding::CommonJs(_) | Binding::Arguments(_) => true,
            };
            if is_global {
                self.file[id].kind = ExprKind::Ident(self.in_global_scope(name));
            }
        }
    }

    /// The other files must not take these for the built-ins. The build goes by the stores that it sees.
    fn show_stores_to_builtins(&mut self, pos: u32) {
        for name in std::mem::take(&mut self.lexical_builtins) {
            if self.left_alone.contains(&name) {
                continue;
            }
            let never = self.binding(self.atoms.intern(b""), pos, pos);
            let target = self.file.expr(ExprKind::Ident(name), pos, pos);
            let value = self.zero(pos);
            let store = self.assign(target, value);
            let store = self.binary(BinOp::And, never, store);
            let store = self.file.stmt(StmtKind::Expr(store), pos);
            self.head.push(store);
        }
    }
}

pub(crate) fn declare_in_global_scope<'s>(
    arena: &'s Arena,
    atoms: &Interner<'s>,
    request: &mut TransformRequest<'_, 's>,
) -> TreeChange {
    let (hir, bound) = (&*request.hir, request.bound);
    let Some(script) = hir.classic_script() else {
        return TreeChange::Unchanged;
    };
    let bindings = atoms.intern(NAME_OF_BINDINGS);
    let (Some(parameter), FnBody::Block(body)) =
        (hir[script].params.iter().next(), hir[script].body)
    else {
        return TreeChange::Unchanged;
    };
    let parameter = hir[parameter].pat;
    if matches!(hir[parameter].kind, PatKind::Ident(name) if name == bindings) {
        return TreeChange::Unchanged;
    }
    let top = bound.fns[script.idx()].scope;
    let hoisted = bound.runtime.annex_b_functions().iter();
    let hoisted = hoisted.filter(|it| bound.symbol_scope(it.var_symbol) == top);
    let mut rewrite = Rewrite {
        file: FileBuilder::from_file(hir),
        atoms,
        bindings,
        left_alone: NAMES_LEFT_ALONE.map(|it| atoms.intern(it)).to_vec(),
        hoisted: hoisted.map(|it| it.function).collect(),
        is_strict: hir[script].is_strict,
        // What follows is declared, and `let` and `const` are not initialized.
        names: b"throw 0;".to_vec(),
        variables: FxHashSet::default(),
        lexical_builtins: Vec::new(),
        head: Vec::new(),
    };
    let declares_nothing = rewrite.names.len();
    let mut statements: Vec<StmtId> = hir.ids(body).collect();
    for &statement in &statements {
        rewrite.visit(statement, true);
    }
    rewrite.rename(bound, top, hir.exprs.len());
    rewrite.show_stores_to_builtins(CLASSIC_SCRIPT_START.len() as u32);
    let Rewrite {
        mut file,
        names,
        head,
        ..
    } = rewrite;
    let is_directive = |it: &&StmtId| matches!(file[**it].kind, StmtKind::Directive { .. });
    let directives = statements.iter().take_while(is_directive).count();
    statements.splice(directives..directives, head);
    file[script].body = FnBody::Block(file.list(&statements));
    file[parameter].kind = PatKind::Ident(bindings);
    (file.specifier_uses).retain(|it| it.kind != SpecifierKind::RequireCall);
    *request.hir = finish_file(file, arena, atoms);
    if names.len() > declares_nothing {
        set_names(request.hir, atoms.intern(&names));
    }
    TreeChange::ChangedAndUnfinished
}
