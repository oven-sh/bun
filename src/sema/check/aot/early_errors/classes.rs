use super::error_classes::has_literal_property_name;
use super::is_instance_constructor_name;
use crate::bind::{ClassOwner, Decl, FnOwner, MemberOwner};
use crate::check::*;

impl Checker<'_, '_> {
    pub(super) fn check_function_early_errors(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for (i, function) in hir.fns.iter().enumerate() {
            match bound.fns[i].owner {
                FnOwner::None | FnOwner::Member(_) | FnOwner::Type(_) => continue,
                FnOwner::Expr(_) | FnOwner::Stmt(_) => {}
            }
            let f = FnId(i as u32);
            match function.kind {
                FnKind::Decl | FnKind::Expr | FnKind::Arrow | FnKind::Constructor => {
                    self.check_grammar_function_like_declaration(file, f);
                }
                FnKind::Method => {
                    self.check_grammar_method(file, f);
                }
                FnKind::Getter | FnKind::Setter => {
                    self.check_grammar_function_like_declaration(file, f);
                    self.check_grammar_accessor(file, f);
                }
                FnKind::StaticBlock
                | FnKind::CallSignature
                | FnKind::ConstructSignature
                | FnKind::FunctionType
                | FnKind::ConstructorType
                | FnKind::IndexSignature => {}
            }
        }
    }

    pub(super) fn check_class_early_errors(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let has_notable_member = hir.rare_syntax & rare::NOTABLE_CLASS_MEMBER != 0;
        for (i, class) in hir.classes.iter().enumerate() {
            let is_reached = match bound.class_owner[i] {
                ClassOwner::Expr(e) => e.is_some(),
                ClassOwner::Stmt(s) => s.is_some(),
            };
            if !is_reached {
                continue;
            }
            let c = ClassId(i as u32);
            for m in class.members.iter() {
                if bound.member_owner[m.idx()] == MemberOwner::Class(c) {
                    self.check_class_member_early_errors(file, m);
                }
            }
            if has_notable_member {
                self.check_class_member_names(file, c);
            }
        }
        if has_notable_member {
            self.check_private_identifiers(file);
        }
    }

    fn check_class_member_early_errors(&mut self, file: FileId, m: MemberId) {
        let hir = self.hir(file);
        let member = &hir[m];
        if !member.modifiers.is_empty() {
            self.check_grammar_modifiers_of_member(file, m);
        }
        let func = member.func;
        match member.kind {
            MemberKind::Property => {
                self.check_grammar_computed_property_name(file, member.key);
            }
            MemberKind::Method
            | MemberKind::Getter
            | MemberKind::Setter
            | MemberKind::Constructor
                if func.is_none() => {}
            MemberKind::Method => {
                self.check_grammar_method(file, func);
                self.check_grammar_computed_property_name(file, member.key);
                if hir[func].flags.contains(Flags::GENERATOR)
                    && is_instance_constructor_name(hir, m)
                {
                    self.early_error_on_node(file, hir.name(hir.node(m)), 1368, &[]);
                }
            }
            MemberKind::Getter | MemberKind::Setter => {
                self.check_grammar_function_like_declaration(file, func);
                self.check_grammar_accessor(file, func);
                self.check_grammar_computed_property_name(file, member.key);
                if is_instance_constructor_name(hir, m) {
                    self.early_error_on_node(file, hir.name(hir.node(m)), 1341, &[]);
                }
            }
            MemberKind::Constructor => {
                self.check_grammar_function_like_declaration(file, func);
            }
            MemberKind::StaticBlock
            | MemberKind::CallSignature
            | MemberKind::ConstructSignature
            | MemberKind::IndexSignature => {}
        }
    }

    fn check_class_member_names(&mut self, file: FileId, c: ClassId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let class_members = || {
            hir[c]
                .members
                .iter()
                .filter(|m| bound.member_owner[m.idx()] == MemberOwner::Class(c))
        };
        let has_duplicate_constructor = class_members()
            .filter(|&m| self.is_instance_constructor_implementation((file, Decl::Member(m))))
            .count()
            > 1;
        for m in class_members() {
            if has_duplicate_constructor
                && self.is_instance_constructor_implementation((file, Decl::Member(m)))
            {
                self.early_error_on_node(file, m, 2392, &[]);
            }
            let member = &hir[m];
            if member.flags.contains(Flags::STATIC)
                && member.key == PropKey::Name(known::prototype)
                && has_literal_property_name(hir, m)
                && matches!(
                    member.kind,
                    MemberKind::Property
                        | MemberKind::Method
                        | MemberKind::Getter
                        | MemberKind::Setter
                )
                && !hir.is_ambient(hir.node(m))
            {
                self.report_static_property_name_conflict(file, m, known::prototype)
                    .class = DiagnosticClass::EarlyError;
            }
            if member.kind == MemberKind::Property
                && member.key == PropKey::Name(known::constructor)
                && has_literal_property_name(hir, m)
            {
                self.early_error_on_node(file, hir.name(hir.node(m)), 18006, &[]);
            }
        }
    }
}
