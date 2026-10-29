use crate::atom::Atom;
use crate::bind::PatParent;
use crate::check::mapped::AccessNode;
use crate::check::shape::{Access, Found};
use crate::check::{Checker, Program, root_declaration};
use crate::hir::{ExprId, PatId, StmtId, VarKind};
use crate::module_format::ModuleFormat;
use crate::program::{FileId, FileRole, Files, Sym};
use crate::resolve::Options;
use crate::types::{SigId, TypeId};

fn is_in_compile_build(files: &Files<'_>, file: FileId) -> bool {
    files.compiled(file).is_some()
}

impl Program<'_> {
    #[inline]
    pub(in crate::check) fn is_in_compile_build(&self, file: FileId) -> bool {
        is_in_compile_build(self.files, file)
    }
}

impl Checker<'_, '_> {
    pub(in crate::check) fn keeps_unique_symbol(&self, name: Option<(FileId, PatId)>) -> bool {
        let Some((file, pattern)) = name else {
            return false;
        };
        let PatParent::Var(declaration) = root_declaration(self.bound(file), pattern) else {
            return false;
        };
        self.p.is_in_compile_build(file)
            && matches!(self.hir(file)[declaration].kind, VarKind::Const)
    }
}

impl<'s> Checker<'_, 's> {
    #[inline]
    pub(in crate::check) fn module_options(&self, file: FileId) -> &'s Options {
        self.files.module_options(file)
    }

    #[inline]
    pub(in crate::check) fn is_in_compile_build(&self, file: FileId) -> bool {
        is_in_compile_build(self.files, file)
    }

    pub(in crate::check) fn no_unchecked_indexed_access_at(&self, node: AccessNode) -> bool {
        let file = match node {
            AccessNode::IndexedAccessType(file, _)
            | AccessNode::ElementAccess(file, _)
            | AccessNode::PropertyName(file, _)
            | AccessNode::BindingName(file, _)
            | AccessNode::Name((file, _, _)) => file,
            AccessNode::None | AccessNode::Other => {
                return self.files.options.no_unchecked_indexed_access;
            }
        };
        self.module_options(file).no_unchecked_indexed_access
    }

    pub(in crate::check) fn property_type_in(
        &mut self,
        file: FileId,
        left_type: TypeId,
        apparent_type: TypeId,
        name: Atom,
        access: Access,
    ) -> Option<(TypeId, Found)> {
        let found = self.property_type(left_type, apparent_type, name, access);
        let of_program = self.files.options.no_unchecked_indexed_access;
        let of_file = self.module_options(file).no_unchecked_indexed_access;
        match found {
            Some((ty, Found::ByIndex)) if access == Access::Read && of_file != of_program => {
                let ty = match of_file {
                    true => self.with_missing(ty),
                    false => self.filter(ty, |_, member| member != TypeId::MISSING),
                };
                Some((ty, Found::ByIndex))
            }
            found => found,
        }
    }

    #[inline]
    pub(in crate::check) fn is_compiled_file(&self, file: FileId) -> bool {
        self.files.is_compiled(file)
    }

    pub(in crate::check) fn is_made_by_loader(&self, file: FileId) -> bool {
        self.is_compiled_file(file) && self.hir(file).source_len == 0
    }

    pub(in crate::check) fn is_declared_in_place_of_bun_types(&self, module: Sym) -> bool {
        self.files.is_shorthand_ambient_module_symbol(module)
            && self.files.is_of_last_resort(module.file)
    }

    pub(in crate::check) fn lacks_bun_types(&self) -> bool {
        !self.files.options.declarations_of_last_resort.is_empty()
    }

    pub(in crate::check) fn is_inferred_file(&self, file: FileId) -> bool {
        self.is_in_compile_build(file) && self.files.role(file) == FileRole::Inferred
    }

    pub(in crate::check) fn follows_untyped_variables(&self, file: FileId) -> bool {
        self.module_options(file).no_implicit_any || self.is_inferred_file(file)
    }

    pub(in crate::check) fn reports_null_checks(&self, file: FileId) -> bool {
        self.files.options.strict_null_checks && self.module_options(file).strict_null_checks
    }

    pub(in crate::check) fn is_under_strict_function_types(&mut self, signature: SigId) -> bool {
        if !self.files.options.strict_function_types || !self.files.is_compile_build() {
            return self.files.options.strict_function_types;
        }
        let declared = self.declared_sig(signature);
        self.sig_decl(declared)
            .is_none_or(|(file, ..)| self.module_options(file).strict_function_types)
    }

    pub(in crate::check) fn reports_implicit_any(&self, file: FileId) -> bool {
        self.module_options(file).no_implicit_any && !self.is_inferred_file(file)
    }

    pub(in crate::check) fn follows_variables_that_start_empty(&self, file: FileId) -> bool {
        self.follows_untyped_variables(file) || self.is_non_strict_file_in_strict_program(file)
    }

    pub(in crate::check) fn is_non_strict_file_in_strict_program(&self, file: FileId) -> bool {
        self.is_in_compile_build(file)
            && self.files.options.strict_null_checks
            && !self.module_options(file).strict_null_checks
    }

    pub(in crate::check) fn is_compiled_as_commonjs(&self, file: FileId) -> bool {
        self.files
            .compiled(file)
            .is_some_and(|compiled| compiled.analysis.module_format == ModuleFormat::CommonJs)
    }

    pub(in crate::check) fn has_only_default_at_run_time(
        &self,
        importer: FileId,
        module_value: TypeId,
    ) -> bool {
        self.is_in_compile_build(importer) && self.every_type(module_value, Self::is_primitive)
    }

    #[inline]
    pub(in crate::check) fn is_dead_statement(&self, file: FileId, statement: StmtId) -> bool {
        self.files
            .compiled(file)
            .is_some_and(|compiled| compiled.analysis.decisions.is_dead_stmt(statement))
    }

    #[inline]
    pub(in crate::check) fn is_dead_expression(&self, file: FileId, expression: ExprId) -> bool {
        self.files
            .compiled(file)
            .is_some_and(|compiled| compiled.analysis.decisions.is_dead_expr(expression))
    }

    #[inline]
    pub(in crate::check) fn is_short_circuited_link(&self, file: FileId, link: ExprId) -> bool {
        self.files
            .compiled(file)
            .is_some_and(|compiled| compiled.analysis.decisions.is_short_circuited_link(link))
    }
}
