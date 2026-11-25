use bun_sema::atom::Atom;
use bun_sema::bind::{FnOwner, Parent};
use bun_sema::check::aot::FunctionRef;
use bun_sema::hir::{CopiedFactory, ExprKind, FnId, PatKind, PropKey};

use super::Callee;
use crate::ir::{Edge, FunctionKey, StringId, ValueId};
use crate::lower::expression::Tail;
use crate::lower::{FileLowering, FunctionLowering, function};

impl FileLowering<'_, '_, '_, '_> {
    fn find_given_name(&self, factory: FnId) -> Option<Atom> {
        let (hir, bound) = (self.hir, self.bound);
        let FnOwner::Expr(expression) = bound.fns[factory.idx()].owner else {
            return None;
        };
        match bound.parent_of_expr(bound.outermost_type_assertion(hir, expression)) {
            Parent::VarInit(declaration) => match hir[hir[declaration].pat].kind {
                PatKind::Ident(name) => Some(name),
                _ => None,
            },
            Parent::Prop(property) => match hir.runtime_property_key(property) {
                PropKey::Name(name) => Some(name),
                _ => None,
            },
            Parent::Expr(parent) => match hir[parent.some()?].kind {
                ExprKind::Assign { target, .. } => match hir[target].kind {
                    ExprKind::Ident(name) => Some(name),
                    _ => None,
                },
                _ => None,
            },
            _ => None,
        }
    }

    fn key_of_factory(&self, factory: FnId) -> FunctionKey {
        FunctionKey::Source(FunctionRef {
            file: self.file,
            function: factory,
        })
    }

    pub(in crate::lower) fn define_missing_factories(&mut self) {
        let hir = self.hir;
        for copied in &hir.copied_factories[..] {
            let key = self.key_of_factory(copied.factory);
            if self.fragment.is_function_named(key) && !self.fragment.is_function_defined(key) {
                let name = self.find_factory_name(copied.factory);
                let header =
                    function::create_header_of_missing_function(self, copied.factory, name);
                let function = self.add_header_of_missing_function(key, header);
                self.lower_left_out_function(function);
            }
        }
    }

    fn find_factory_name(&mut self, factory: FnId) -> Option<StringId> {
        match self.hir[factory].name.is_some() {
            true => Some(self.intern_own_name(factory)),
            false => {
                let name = self.find_given_name(factory)?;
                Some(self.intern_atom(name))
            }
        }
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn emit_closure_of_copy(&mut self, copied: &CopiedFactory, copy: FnId) -> ValueId {
        let name = self.file.find_factory_name(copied.factory);
        let function = function::declare_source_function(self.file, copy, name);
        self.emit_closure(function, None)
    }

    pub(in crate::lower) fn lower_call_of_copied_factory(
        &mut self,
        copied: &CopiedFactory,
    ) -> ValueId {
        let hir = self.file.hir;
        let ExprKind::Binary { right: call, .. } = hir[copied.sequence].kind else {
            unreachable!("a copied factory precedes its call");
        };
        let ExprKind::Fn(copy) = hir[copied.function].kind else {
            unreachable!("a copied factory is a function");
        };
        let site = hir[copied.call];
        let called_by_name = self.file.scopes.function_called_by_name(call);
        if called_by_name.is_some_and(|function| function != copied.factory) {
            return self.lower_expression(call);
        }
        if called_by_name.is_some() {
            let arguments = self.lower_arguments(site.args);
            self.set_position(hir[call].pos);
            let callee = Callee::without_key(
                self.emit_closure_of_copy(copied, copy),
                None,
                self.file.find_callee_name(site.callee),
            );
            return self.emit_call_expression(call, callee, arguments, Tail::No);
        }
        let callee = self.lower_callee(site.callee, None, None);
        let arguments = self.lower_arguments(site.args);
        self.set_position(hir[call].pos);
        let ordinary = self.create_block();
        let other_callee = Callee {
            function: self.builder.add_edge_result(ordinary),
            key: None,
            ..callee
        };
        let key = self.file.key_of_factory(copied.factory);
        let factory = self.file.reference_function(key);
        let is_factory = self.builder.is_closure_of(factory, callee.function);
        let enters_copy = self.create_block();
        let differs = Edge::with_proofs(ordinary, &[0]);
        self.builder
            .branch(is_factory, Edge::to(enters_copy), differs);
        let result = self.builder.create_variable(None);
        let done = self.create_block();

        self.continue_in(enters_copy);
        let closure = self.emit_closure_of_copy(copied, copy);
        let copy_callee = Callee::without_key(closure, callee.this, callee.name);
        let created = self.emit_call_expression(call, copy_callee, arguments.clone(), Tail::No);
        self.builder.write_variable(result, created);
        self.jump(done);

        self.continue_in(ordinary);
        let created = self.emit_call_expression(call, other_callee, arguments, Tail::No);
        self.builder.write_variable(result, created);
        self.jump(done);

        self.continue_in(done);
        self.builder.read_variable(result)
    }
}
