use crate::atom::known;
use crate::bind::Decl;
use crate::check::Checker;
use crate::check::aot::DiagnosticClass;
use crate::check::spans::is_word_at;
use crate::hir::{
    ExprId, ExprKind, File, Flags, FnBody, MemberId, MemberKind, PropKey, StmtId, StmtKind,
    VarKind, has_body, is_parenthesized,
};
use crate::node::{Kind, Node};
use crate::program::FileId;
use std::ops::ControlFlow;

pub(super) fn has_literal_property_name(hir: &File<'_>, member: MemberId) -> bool {
    matches!(
        hir.kind(hir.name(hir.node(member))),
        Kind::Identifier | Kind::StringLiteral
    )
}

pub(in crate::check) fn is_instance_constructor_name(hir: &File<'_>, member: MemberId) -> bool {
    hir[member].key == PropKey::Name(known::constructor)
        && !hir[member].flags.contains(Flags::STATIC)
        && has_literal_property_name(hir, member)
}

impl Checker<'_, '_> {
    pub(in crate::check) fn special_constructor_error_class(
        &self,
        file: FileId,
        member: MemberId,
    ) -> DiagnosticClass {
        let hir = self.hir(file);
        if is_instance_constructor_name(hir, member) {
            self.early_error_class(file, hir.name(hir.node(member)))
        } else {
            DiagnosticClass::Semantic
        }
    }

    pub(in crate::check) fn super_early_error_code(hir: &File<'_>, sup: Node) -> Option<u32> {
        let is_call = hir.kind(hir.parent(sup)) == Kind::CallExpression
            && hir.expression(hir.parent(sup)) == sup;
        let mut container = hir.get_super_container(sup);
        while hir.kind(container) == Kind::ArrowFunction {
            container = hir.get_super_container(container);
        }
        let class = hir.class_of(hir.parent(container)).some();
        let is_in_object_literal = hir.kind(hir.parent(container)) == Kind::ObjectLiteralExpression;
        let is_legal = if is_call {
            hir.kind(container) == Kind::Constructor && !hir.is_static(container)
        } else {
            (class.is_some() || is_in_object_literal)
                && matches!(
                    hir.kind(container),
                    Kind::MethodDeclaration
                        | Kind::GetAccessor
                        | Kind::SetAccessor
                        | Kind::PropertyDeclaration
                        | Kind::ClassStaticBlockDeclaration
                        | Kind::Constructor
                )
        };
        if is_legal {
            let has_no_heritage = class.is_some_and(|class| hir[class].extends.is_none());
            return (is_call && has_no_heritage).then_some(2335);
        }
        let computed_name = hir.find_ancestor_or_quit(sup, |node| {
            if node == container {
                ControlFlow::Break(false)
            } else if hir.kind(node) == Kind::ComputedPropertyName {
                ControlFlow::Break(true)
            } else {
                ControlFlow::Continue(())
            }
        });
        Some(if computed_name.is_some() {
            2466
        } else if is_call {
            2337
        } else if class.is_none() && !is_in_object_literal {
            2660
        } else {
            2338
        })
    }

    pub(in crate::check) fn super_error_class(hir: &File<'_>, sup: Node) -> DiagnosticClass {
        DiagnosticClass::early_error_if(
            Self::super_early_error_code(hir, sup).is_some(),
            DiagnosticClass::Semantic,
        )
    }

    pub(in crate::check) fn is_new_target_outside_function(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let container = hir.get_this_container(hir.node(e), false, false);
        hir.kind(container) == Kind::SourceFile && !self.is_compiled_as_commonjs(file)
    }

    pub(in crate::check) fn is_in_class_initializer(hir: &File<'_>, node: Node) -> bool {
        matches!(
            hir.kind(hir.get_this_container(node, false, false)),
            Kind::PropertyDeclaration | Kind::ClassStaticBlockDeclaration
        ) && !hir.is_in_type_query(node)
    }

    pub(in crate::check) fn is_for_async_of(&self, file: FileId, statement: StmtId) -> bool {
        let hir = self.hir(file);
        let StmtKind::ForOf {
            left,
            is_await: false,
            ..
        } = hir[statement].kind
        else {
            return false;
        };
        matches!(left.some().map(|left| hir[left].kind), Some(StmtKind::Expr(target))
            if matches!(hir[target].kind, ExprKind::Ident(name) if name == known::async_)
                && !is_parenthesized(hir, target)
                && is_word_at(&hir.text, self.start_of(file, target) as usize, b"async"))
    }

    pub(in crate::check) fn strict_mode_statement_error_class(
        &self,
        file: FileId,
        statement: StmtId,
    ) -> DiagnosticClass {
        let hir = self.hir(file);
        if let StmtKind::Labeled { body, .. } = hir[statement].kind {
            return self.labeled_declaration_error_class(file, body);
        }
        self.strict_mode_error_class(file, hir.node(statement))
    }

    fn labeled_declaration_error_class(&self, file: FileId, body: StmtId) -> DiagnosticClass {
        let hir = self.hir(file);
        match hir[body].kind {
            StmtKind::Var(declarations) => match declarations.iter().next().map(|d| hir[d].kind) {
                Some(VarKind::Var) | None => DiagnosticClass::TypeScriptGrammar,
                Some(VarKind::Let | VarKind::Const | VarKind::Using | VarKind::AwaitUsing) => {
                    DiagnosticClass::EarlyError
                }
            },
            StmtKind::Fn(function) => DiagnosticClass::early_error_if(
                hir[function]
                    .flags
                    .intersects(Flags::ASYNC | Flags::GENERATOR),
                DiagnosticClass::TypeScriptGrammar,
            ),
            StmtKind::Class(_)
            | StmtKind::Import(_)
            | StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportDefault(_) => DiagnosticClass::EarlyError,
            _ => DiagnosticClass::TypeScriptGrammar,
        }
    }

    pub(super) fn is_instance_constructor_implementation(
        &self,
        declaration: (FileId, Decl),
    ) -> bool {
        let (file, decl) = declaration;
        let hir = self.hir(file);
        matches!(decl, Decl::Member(member)
            if hir[member].kind == MemberKind::Constructor
                && !hir[member].flags.contains(Flags::STATIC)
                && hir[member].func.is_some()
                && has_body(&hir[hir[member].func]))
            && !self.is_in_ambient_context(declaration)
    }

    pub(in crate::check) fn duplicate_implementation_class(
        &self,
        declarations: &[(FileId, Decl)],
        declaration: (FileId, Decl),
        code: u32,
    ) -> DiagnosticClass {
        let is_constructor =
            |it: &&(FileId, Decl)| self.is_instance_constructor_implementation(**it);
        let is_early_error = code == 2392
            && self.is_instance_constructor_implementation(declaration)
            && declarations.iter().filter(is_constructor).count() > 1;
        DiagnosticClass::early_error_if(is_early_error, DiagnosticClass::of_code(code))
    }

    pub(in crate::check) fn is_runtime_export_declaration(
        &self,
        declaration: (FileId, Decl),
    ) -> bool {
        let (file, decl) = declaration;
        let hir = self.hir(file);
        let is_export = match decl {
            Decl::Var(_) | Decl::Class(_) => true,
            Decl::Fn(function) => !matches!(hir[function].body, FnBody::None),
            Decl::ExportSpec(specifier) => {
                !hir[specifier].type_only && !hir[hir[specifier].export].type_only
            }
            Decl::ExportStarAs(statement) => matches!(
                hir[statement].kind,
                StmtKind::ExportStar {
                    type_only: false,
                    ..
                }
            ),
            Decl::ExportExpr(statement) => {
                matches!(hir[statement].kind, StmtKind::ExportDefault(_))
            }
            _ => false,
        };
        is_export && !self.is_in_ambient_context(declaration)
    }
}
