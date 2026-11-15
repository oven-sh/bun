use bun_core::strings;
use bun_sema::bind::{Binding, CommonJsVariable, Decl, Parent, SymbolId};
use bun_sema::hir::{BinOp, CallId, ExprId, ExprKind, UnOp};
use bun_sema::util::FxHashSet;

use super::variables::directory_of_source;
use crate::builtins::table::Platforms;
use crate::ir::ValueId;
use crate::load::contents::worker_entries::write_url_of_path;
use crate::load::module_paths::with_separators_of_host;
use crate::lower::operator::{OperatorClass, classify_operator, emit_comparison};
use crate::lower::{FileLowering, FunctionLowering};

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(in crate::lower) struct PathComparison {
    equality: ExprId,
    path: ExprId,
}

enum UseOfPath {
    Compared(PathComparison),
    Kept(SymbolId),
    Part(ExprId),
}

fn keeps_path(name: &[u8]) -> bool {
    matches!(
        name,
        b"basename"
            | b"dirname"
            | b"fileURLToPath"
            | b"href"
            | b"join"
            | b"native"
            | b"normalize"
            | b"pathToFileURL"
            | b"pathname"
            | b"realpathSync"
            | b"replace"
            | b"resolve"
            | b"toString"
            | b"URL"
    )
}

impl FileLowering<'_, '_, '_, '_> {
    pub(super) fn find_path_comparisons(&self) -> Vec<PathComparison> {
        let names = self.bound.ident_bindings().iter();
        let names = names.filter(|it| {
            matches!(
                it.1,
                Binding::CommonJs(CommonJsVariable::Filename | CommonJsVariable::Dirname)
            )
        });
        let names = names.filter(|it| !self.decisions().is_dead_expr(it.0));
        let mut paths: Vec<ExprId> = names.map(|it| it.0).collect();
        let mut comparisons = Vec::new();
        let mut uses: Option<Vec<(SymbolId, ExprId)>> = None;
        let (mut seen, mut kept) = (FxHashSet::default(), FxHashSet::default());
        while let Some(path) = paths.pop() {
            match self.find_use_of_path(path) {
                Some(UseOfPath::Compared(comparison)) => comparisons.push(comparison),
                Some(UseOfPath::Part(whole)) if seen.insert(whole) => paths.push(whole),
                Some(UseOfPath::Kept(symbol)) if kept.insert(symbol) => {
                    let uses = uses.get_or_insert_with(|| self.find_path_like_uses());
                    let start = uses.partition_point(|it| it.0 < symbol);
                    let end = uses.partition_point(|it| it.0 <= symbol);
                    paths.extend(uses[start..end].iter().map(|it| it.1));
                }
                Some(UseOfPath::Part(_) | UseOfPath::Kept(_)) | None => {}
            }
        }
        comparisons.sort_unstable();
        comparisons.dedup();
        comparisons
    }

    fn find_path_like_uses(&self) -> Vec<(SymbolId, ExprId)> {
        let (hir, bound) = (self.hir, self.bound);
        let expressions = (0..hir.exprs.len() as u32).map(ExprId);
        let names = expressions.filter(|&it| {
            matches!(hir[it].kind, ExprKind::Ident(_))
                && self.find_use_of_path(it).is_some()
                && bound.is_evaluated_ident(it)
                && !self.decisions().is_dead_expr(it)
        });
        let uses = names.filter_map(|name| match bound.binding(name) {
            Binding::Symbol(symbol) => Some((symbol, name)),
            Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => None,
        });
        let mut uses: Vec<_> = uses.collect();
        uses.sort_unstable();
        uses
    }

    fn find_use_of_path(&self, path: ExprId) -> Option<UseOfPath> {
        let (hir, bound) = (self.hir, self.bound);
        let parent = match bound.parent_of_expr(path) {
            Parent::Expr(parent) => parent,
            Parent::VarInit(declaration) => {
                return self.find_variable(Decl::Var(hir[declaration].pat));
            }
            Parent::ParamDefault(parameter) => {
                return self.find_variable(Decl::Param(hir[parameter].pat));
            }
            _ => return None,
        };
        let is_path_too = match hir[parent].kind {
            ExprKind::Binary { op, left, right } => match classify_operator(op) {
                OperatorClass::Equality { .. } => {
                    let other = if left == path { right } else { left };
                    let equality = parent;
                    let comparison = PathComparison { equality, path };
                    return (self.may_be_path(other)).then_some(UseOfPath::Compared(comparison));
                }
                OperatorClass::ControlFlow => op != BinOp::Comma || right == path,
                OperatorClass::Plain => op == BinOp::Add,
                OperatorClass::Ordering | OperatorClass::In => false,
            },
            ExprKind::Assign {
                op: None,
                target,
                value,
            } => {
                let target = self.skip_type_syntax(target);
                return match hir[target].kind {
                    ExprKind::Ident(_) if value == path => match bound.binding(target) {
                        Binding::Symbol(symbol) => Some(UseOfPath::Kept(symbol)),
                        Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => None,
                    },
                    _ => None,
                };
            }
            ExprKind::Cond { test, .. } => test != path,
            ExprKind::Dot { name, .. } => keeps_path(self.queries.atom_bytes(name)),
            ExprKind::Call(call) | ExprKind::New(call) => {
                hir[call].callee == path || self.calls_function_of_paths(call)
            }
            ExprKind::Template { .. }
            | ExprKind::Await(_)
            | ExprKind::As { .. }
            | ExprKind::Satisfies { .. }
            | ExprKind::AsConst(_)
            | ExprKind::NonNull(_) => true,
            _ => false,
        };
        is_path_too.then_some(UseOfPath::Part(parent))
    }

    fn find_variable(&self, declaration: Decl) -> Option<UseOfPath> {
        let symbol = self.bound.declared_symbol(declaration);
        symbol.some().map(UseOfPath::Kept)
    }

    fn calls_function_of_paths(&self, call: CallId) -> bool {
        let hir = self.hir;
        let mut callee = self.skip_type_syntax(hir[call].callee);
        while let ExprKind::Binary {
            op: BinOp::Comma,
            right,
            ..
        } = hir[callee].kind
        {
            callee = self.skip_type_syntax(right);
        }
        match hir[callee].kind {
            ExprKind::Ident(name) | ExprKind::Dot { name, .. } => {
                keeps_path(self.queries.atom_bytes(name))
            }
            _ => false,
        }
    }

    fn may_be_path(&self, operand: ExprId) -> bool {
        !matches!(
            self.hir[self.skip_type_syntax(operand)].kind,
            ExprKind::Null
                | ExprKind::True
                | ExprKind::False
                | ExprKind::Number(_)
                | ExprKind::String(_)
                | ExprKind::Unary {
                    op: UnOp::Typeof | UnOp::Void | UnOp::Not,
                    ..
                }
        )
    }

    pub(in crate::lower) fn find_path_comparison(
        &self,
        equality: ExprId,
    ) -> Option<PathComparison> {
        let comparisons = &self.modules.path_comparisons;
        let index = comparisons.binary_search_by_key(&equality, |it| it.equality);
        index.ok().map(|index| comparisons[index])
    }

    fn find_file_spellings(&self) -> Vec<[Vec<u8>; 2]> {
        let sources = self.inputs.sources;
        let is_windows = self.inputs.options.platform.contains(Platforms::WINDOWS);
        let entry_points = sources.entry_points().iter().map(|it| it.file);
        let mut spellings = Vec::new();
        for file in entry_points.chain([self.file]) {
            let Some(path) = sources.source_path(file) else {
                continue;
            };
            let paths = [
                with_separators_of_host(sources.public_path(file), is_windows),
                path,
            ];
            let mut add = |spell: &dyn Fn(&[u8]) -> Option<Vec<u8>>| {
                if let [Some(in_executable), Some(at_build)] = paths.each_ref().map(|it| spell(it))
                    && !spellings.contains(&[in_executable.clone(), at_build.clone()])
                {
                    spellings.push([in_executable, at_build]);
                }
            };
            add(&|path| Some(path.to_vec()));
            add(&|path| Some(without_extension(path).to_vec()));
            add(&|path| Some(directory_of_source(path).to_vec()));
            add(&|path| write_url_of_path(path));
            add(&|path| write_url_of_path(without_extension(path)));
        }
        spellings
    }
}

fn without_extension(path: &[u8]) -> &[u8] {
    let name = path.len() - bun_paths::basename(path).len();
    match strings::last_index_of_char(&path[name..], b'.') {
        Some(dot) if dot > 0 => &path[..name + dot],
        _ => path,
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn lower_path_comparison(
        &mut self,
        comparison: PathComparison,
        op: BinOp,
        [left, right]: [ExprId; 2],
    ) -> ValueId {
        let values = [left, right].map(|operand| self.lower_expression(operand));
        self.set_position(self.file.hir[comparison.equality].pos);
        let (mut test, is_negated) = emit_comparison(self, op, values[0], values[1]);
        let is_left = comparison.path == left;
        let [path, other] = if is_left {
            values
        } else {
            [values[1], values[0]]
        };
        for texts in self.file.find_file_spellings() {
            let [in_executable, at_build] = texts.map(|text| self.emit_text(&text));
            let is_path = self.builder.strict_eq(path, at_build);
            let is_other = self.builder.strict_eq(other, in_executable);
            let are_one_file = self.builder.bit_and(is_path, is_other);
            test = self.builder.bit_or(test, are_one_file);
        }
        let test = self.builder.to_boolean(test);
        match is_negated {
            true => self.builder.logical_not(test),
            false => test,
        }
    }
}
