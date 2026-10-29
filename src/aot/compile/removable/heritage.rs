use bun_sema::bind::{BindingInitializer, BindingKind, Parent, SymbolId};
use bun_sema::hir::FnKind;

use super::*;
use crate::builtins::BuiltinPath;

fn is_locked_constructor(path: BuiltinPath) -> bool {
    let constructor = table::canonical_id(path.id);
    let is_prototype = |&member: &BuiltinId| table::entry(member).kind == BuiltinKind::Prototype;
    path.mutability == Mutability::AlwaysLocked
        && table::entry(constructor).kind == BuiltinKind::Constructor
        && table::members(constructor).iter().any(is_prototype)
}

// Defining a class throws unless it extends `null` or a constructor whose `prototype` is an object or `null`.
impl Removable<'_, '_> {
    pub(crate) fn has_valid_heritage(&self, class: ClassId) -> bool {
        let node = &self.hir[class];
        node.flags.contains(Flags::AMBIENT) || self.is_valid_heritage(node.extends)
    }

    fn is_valid_heritage(&self, heritage: ExprId) -> bool {
        let hir = self.hir;
        if heritage.is_none() || self.analysis.decisions.is_dead_expr(heritage) {
            return true;
        }
        let heritage = hir.skip_type_assertions(heritage);
        if let Some(constant) = self.find_constant(heritage) {
            return matches!(constant, Constant::Null);
        }
        if let Some(Resolved::Builtin(path)) = self.builtins.of_pure_expr(heritage) {
            return is_locked_constructor(path);
        }
        if !self.stack.is_safe_to_recurse() {
            return false;
        }
        match hir[heritage].kind {
            ExprKind::Null | ExprKind::Class(_) => true,
            ExprKind::Fn(function) => {
                let function = &hir[function];
                function.kind == FnKind::Expr
                    && !function.flags.intersects(Flags::ASYNC | Flags::GENERATOR)
            }
            ExprKind::Ident(_) => match self.find_static_binding(heritage) {
                Some(Binding::Symbol(symbol)) => self.holds_class_at(heritage, symbol),
                _ => false,
            },
            ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                self.modules.is_some_and(|(modules, file)| {
                    let export = match modules.member(file, heritage) {
                        Some(Member::Binding(export)) => Some(export),
                        _ => match modules.member_binding(file, heritage) {
                            Some(ImportBinding::Variable(export)) => Some(export),
                            _ => None,
                        },
                    };
                    export.is_some_and(|export| self.imports_class(export))
                })
            }
            // `/* @__PURE__ */` promises that the call can go when nothing uses the class.
            ExprKind::Call(call) => hir[call].is_pure && !self.options.ignores_pure_annotations,
            ExprKind::Cond { branches, .. } => {
                let branches = hir.branches(branches);
                self.is_valid_heritage(branches.yes) && self.is_valid_heritage(branches.no)
            }
            ExprKind::Binary { op, left, right } => match op {
                BinOp::Comma => self.is_valid_heritage(right),
                BinOp::And | BinOp::Or | BinOp::Nullish => {
                    self.is_valid_heritage(left) && self.is_valid_heritage(right)
                }
                _ => false,
            },
            _ => false,
        }
    }

    // A function's `prototype` can be assigned, a class's can't.
    fn is_bound_to_class(&self, symbol: SymbolId) -> bool {
        let hir = self.hir;
        let class = match self.bound.binding_initializer(hir, symbol) {
            BindingInitializer::Class(class) => class,
            BindingInitializer::Expression(value) => {
                match hir[hir.skip_type_assertions(value)].kind {
                    ExprKind::Class(class) => class,
                    _ => return false,
                }
            }
            _ => return false,
        };
        self.bound.is_stable_binding(symbol) && !self.has_decorator(hir[class].modifiers)
    }

    fn holds_class_at(&self, read: ExprId, symbol: SymbolId) -> bool {
        if self.bound.binding_kind(symbol) != BindingKind::Import {
            return self.is_bound_to_class(symbol) && self.has_initializer_run_at(read, symbol);
        }
        self.modules.is_some_and(
            |(modules, file)| match modules.import_binding(file, symbol) {
                ImportBinding::Variable(export) => self.imports_class(export),
                _ => false,
            },
        )
    }

    fn holds_class_once_file_has_run(&self, symbol: SymbolId) -> bool {
        let declaration = self.bound.initializing_declaration(symbol);
        let statement = declaration.and_then(|declaration| self.declaration_statement(declaration));
        self.is_bound_to_class(symbol)
            && statement
                .is_some_and(|(statement, _)| self.bound.parent_of_stmt(statement) == Parent::File)
    }

    fn imports_class(&self, export: Sym) -> bool {
        let Some((modules, file)) = self.modules else {
            return false;
        };
        !modules.may_run_before(ModuleRef::File(file), ModuleRef::File(export.file))
            && Removable::new(self.files, export.file, self.options)
                .is_some_and(|exporter| exporter.holds_class_once_file_has_run(export.id))
    }
}
