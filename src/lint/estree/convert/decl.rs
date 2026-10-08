//! Functions, classes, interfaces and enums.

use super::{Converter, Extras};
use crate::ast::{
    Class, Enum, EnumMember, Flags, FnBody, FnKind, Func, Interface, Member, MemberKind, Param,
    TypeKind, TypeNode,
};
use crate::estree::NodeType::{self, *};
use crate::estree::Sink;
use crate::span::Span;

impl<'a, S: Sink> Converter<'a, '_, S> {
    // ───────────────────────────── functions ─────────────────────────────

    /// The fields `params`, `returnType` and `typeParameters`. `has_decorators`: the parameters can
    /// have decorators, which those of a method of an object literal cannot.
    pub(super) fn signature(&mut self, func: Func<'a>, has_decorators: bool) {
        self.list("params", func.params_with_this(), |this, it| this.param(it, has_decorators));
        self.type_annotation("returnType", func.return_type());
        self.type_parameters(func.type_params());
    }

    /// The field `body` with the block of `func`, or with `null`.
    fn body(&mut self, func: Func<'a>) {
        self.field("body");
        match (func.body(), func.body_span()) {
            (FnBody::Block(statements), Some(span)) => self.block(span, statements, true),
            _ => self.out.null(),
        }
    }

    pub(super) fn function_declaration(&mut self, span: Span, func: Func<'a>, is_declared: bool) {
        self.open(if func.has_body() { FunctionDeclaration } else { TSDeclareFunction }, span);
        self.flag("async", func.is_async());
        if func.has_body() {
            self.body(func);
        }
        self.flag("declare", is_declared);
        self.flag("expression", false);
        self.flag("generator", func.is_generator());
        self.field("id");
        match func.name() {
            Some(name) => self.ident(name),
            None => self.out.null(),
        }
        self.signature(func, true);
        self.close();
    }

    pub(super) fn function_expression(&mut self, span: Span, func: Func<'a>) {
        self.open(FunctionExpression, span);
        self.flag("async", func.is_async());
        self.body(func);
        self.flag("declare", false);
        self.flag("expression", false);
        self.flag("generator", func.is_generator());
        self.field("id");
        match func.name() {
            Some(name) => self.ident(name),
            None => self.out.null(),
        }
        self.signature(func, true);
        self.close();
    }

    pub(super) fn arrow_function(&mut self, span: Span, func: Func<'a>) {
        self.open(ArrowFunctionExpression, span);
        self.flag("async", func.is_async());
        match func.body() {
            FnBody::Expr(e) => {
                self.field("body");
                self.expr(e);
            }
            _ => self.body(func),
        }
        self.flag("expression", matches!(func.body(), FnBody::Expr(_)));
        self.flag("generator", false);
        self.null("id");
        self.signature(func, true);
        self.close();
    }

    /// The function that is the `value` of a method, an accessor or a constructor.
    pub(super) fn method_value(&mut self, func: Func<'a>, has_decorators: bool) {
        let node_type = if func.has_body() { FunctionExpression } else { TSEmptyBodyFunctionExpression };
        self.open(node_type, func.span_from_params());
        self.flag("async", func.is_async());
        self.body(func);
        self.flag("declare", false);
        self.flag("expression", false);
        self.flag("generator", func.is_generator());
        self.null("id");
        self.signature(func, has_decorators);
        self.close();
    }

    pub(super) fn param(&mut self, param: Param<'a>, has_decorators: bool) {
        let decorators = has_decorators.then(|| param.modifiers());
        let keywords = Self::keywords(param.modifiers());
        if keywords.is_empty() {
            return self.param_without_keywords(param, decorators);
        }
        self.open(TSParameterProperty, param.span());
        self.accessibility(keywords);
        self.decorators(decorators);
        self.flag("override", keywords.contains(Flags::OVERRIDE));
        self.field("parameter");
        self.param_without_keywords(param, None);
        self.flag("readonly", keywords.contains(Flags::READONLY));
        self.flag("static", keywords.contains(Flags::STATIC));
        self.close();
    }

    fn param_without_keywords(
        &mut self,
        param: Param<'a>,
        decorators: Option<crate::ast::List<'a, crate::ast::Modifier<'a>>>,
    ) {
        let pat = param.pat();
        let extras = Extras {
            is_optional: param.is_optional(),
            ty: param.ty(),
            end: param.binding_span().end,
            decorators,
        };
        if param.is_rest() {
            self.open(RestElement, param.span());
            self.field("argument");
            self.plain_pat(pat);
            self.decorators(decorators);
            self.flag("optional", extras.is_optional);
            self.type_annotation("typeAnnotation", extras.ty);
            self.close();
        } else if let Some(default) = param.default() {
            let span = Span::new(pat.span().start, default.outer_span().end);
            self.assignment_pattern(span, pat, extras, default);
        } else {
            self.pat(pat, extras);
        }
    }

    // ───────────────────────────── classes ─────────────────────────────

    pub(super) fn class(&mut self, node_type: NodeType, span: Span, class: Class<'a>) {
        let keywords = Self::keywords(class.modifiers());
        self.open(node_type, span);
        self.flag("abstract", keywords.contains(Flags::ABSTRACT));
        self.flag("declare", keywords.contains(Flags::AMBIENT));
        self.decorators(Some(class.modifiers()));
        self.field("id");
        match class.name() {
            Some(name) => self.ident(name),
            None => self.out.null(),
        }
        self.type_parameters(class.type_params());
        self.field("superClass");
        self.opt_expr(class.extends());
        self.type_arguments("superTypeArguments", class.extends_args());
        self.list("implements", class.implements(), |this, it| this.heritage(TSClassImplements, it));
        self.field("body");
        self.open(ClassBody, class.body_span());
        self.list("body", class.members(), Self::class_member);
        self.close();
        self.close();
    }

    /// An element of `implements`, or of the `extends` of an interface.
    fn heritage(&mut self, node_type: NodeType, ty: TypeNode<'a>) {
        self.open(node_type, ty.span());
        self.field("expression");
        match ty.kind() {
            TypeKind::Ref { name, args } => {
                self.entity_name(name, MemberExpression);
                self.type_arguments("typeArguments", args);
            }
            TypeKind::Heritage { expr, args } => {
                self.expr(expr);
                self.type_arguments("typeArguments", args);
            }
            _ => self.out.null(),
        }
        self.close();
    }

    fn class_member(&mut self, member: Member<'a>) {
        let (span, flags) = (member.span(), member.flags());
        let keywords = Self::keywords(member.modifiers());
        let is_abstract = keywords.contains(Flags::ABSTRACT);
        match member.kind() {
            MemberKind::Property => {
                let node_type = match (keywords.contains(Flags::ACCESSOR), is_abstract) {
                    (true, true) => TSAbstractAccessorProperty,
                    (true, false) => AccessorProperty,
                    (false, true) => TSAbstractPropertyDefinition,
                    (false, false) => PropertyDefinition,
                };
                self.open(node_type, span);
                self.accessibility(keywords);
                self.member_key(member);
                self.flag("declare", keywords.contains(Flags::AMBIENT));
                self.decorators(Some(member.modifiers()));
                self.flag("definite", flags.contains(Flags::DEFINITE));
                self.flag("optional", flags.contains(Flags::OPTIONAL));
                self.flag("override", keywords.contains(Flags::OVERRIDE));
                self.flag("readonly", keywords.contains(Flags::READONLY));
                self.flag("static", keywords.contains(Flags::STATIC));
                self.type_annotation("typeAnnotation", member.ty());
                self.field("value");
                self.opt_expr(member.init().filter(|_| !is_abstract));
                self.close();
            }
            MemberKind::Method | MemberKind::Getter | MemberKind::Setter | MemberKind::Constructor => {
                let is_static = keywords.contains(Flags::STATIC);
                let is_constructor = member.kind() == MemberKind::Constructor;
                self.open(if is_abstract { TSAbstractMethodDefinition } else { MethodDefinition }, span);
                self.accessibility(keywords);
                match member.constructor_keyword() {
                    Some(keyword) => {
                        self.flag("computed", false);
                        self.field("key");
                        self.module_export_name(keyword);
                    }
                    None => self.member_key(member),
                }
                self.decorators((!is_constructor).then(|| member.modifiers()));
                let is_named_constructor = |key: crate::ast::Key<'a>| {
                    matches!(key.kind(), crate::ast::KeyKind::String(name) if name.is("constructor"))
                };
                let kind: &[u8] = match member.kind() {
                    MemberKind::Getter => b"get",
                    MemberKind::Setter => b"set",
                    MemberKind::Constructor if !is_static => b"constructor",
                    // `"constructor"<T>() {}`
                    MemberKind::Method if !is_static && member.key().is_some_and(is_named_constructor) => {
                        b"constructor"
                    }
                    _ => b"method",
                };
                self.text("kind", kind);
                self.flag("optional", !is_constructor && flags.contains(Flags::OPTIONAL));
                self.flag("override", !is_constructor && keywords.contains(Flags::OVERRIDE));
                self.flag("static", is_static);
                self.field("value");
                match member.func() {
                    Some(func) => self.method_value(func, true),
                    None => self.out.null(),
                }
                self.close();
            }
            MemberKind::StaticBlock => {
                self.open(StaticBlock, span);
                match member.func().and_then(Func::body_statements) {
                    Some(statements) => self.statements("body", statements, true),
                    None => self.empty("body"),
                }
                self.close();
            }
            MemberKind::IndexSignature | MemberKind::CallSignature | MemberKind::ConstructSignature => {
                self.type_member(member);
            }
        }
    }

    /// The fields `computed` and `key`.
    fn member_key(&mut self, member: Member<'a>) {
        match member.key() {
            Some(key) => self.key(key),
            None => self.null("key"),
        }
    }

    // ───────────────────────────── interfaces and type literals ─────────────────────────────

    pub(super) fn interface(&mut self, span: Span, interface: Interface<'a>, is_declared: bool) {
        self.open(TSInterfaceDeclaration, span);
        self.flag("declare", is_declared);
        self.field("id");
        self.ident(interface.name());
        self.type_parameters(interface.type_params());
        self.list("extends", interface.extends(), |this, it| this.heritage(TSInterfaceHeritage, it));
        self.field("body");
        self.open(TSInterfaceBody, interface.body_span());
        self.list("body", interface.members(), Self::type_member);
        self.close();
        self.close();
    }

    /// A member of an interface or a type literal.
    pub(super) fn type_member(&mut self, member: Member<'a>) {
        let (span, flags) = (member.span(), member.flags());
        let keywords = Self::keywords(member.modifiers());
        let func = member.func();
        match (member.kind(), func) {
            (MemberKind::CallSignature | MemberKind::ConstructSignature, Some(func)) => {
                let is_call = func.kind() == FnKind::CallSignature;
                let node_type = if is_call { TSCallSignatureDeclaration } else { TSConstructSignatureDeclaration };
                self.open(node_type, span);
                self.signature(func, true);
                return self.close();
            }
            (MemberKind::IndexSignature, Some(func)) => {
                self.open(TSIndexSignature, span);
                self.list("parameters", func.params(), |this, it| this.param(it, false));
                self.type_annotation("typeAnnotation", func.return_type());
            }
            (_, Some(func)) => {
                self.open(TSMethodSignature, span);
                self.member_key(member);
                let kind: &[u8] = match member.kind() {
                    MemberKind::Getter => b"get",
                    MemberKind::Setter => b"set",
                    _ => b"method",
                };
                self.text("kind", kind);
                self.flag("optional", flags.contains(Flags::OPTIONAL));
                self.signature(func, true);
            }
            (_, None) => {
                self.open(TSPropertySignature, span);
                self.member_key(member);
                self.flag("optional", flags.contains(Flags::OPTIONAL));
                self.type_annotation("typeAnnotation", member.ty());
            }
        }
        self.accessibility(keywords);
        self.flag("readonly", keywords.contains(Flags::READONLY));
        self.flag("static", keywords.contains(Flags::STATIC));
        self.close();
    }

    // ───────────────────────────── enums ─────────────────────────────

    pub(super) fn enumeration(&mut self, span: Span, it: Enum<'a>, is_declared: bool) {
        self.open(TSEnumDeclaration, span);
        self.flag("const", it.flags().contains(Flags::CONST));
        self.flag("declare", is_declared);
        self.field("id");
        self.ident(it.name());
        self.field("body");
        self.open(TSEnumBody, it.body_span());
        self.list("members", it.members(), |this, member: EnumMember<'a>| {
            this.open(TSEnumMember, member.span());
            this.field("id");
            match member.key() {
                Some(key) => this.key_value(key),
                None => this.out.null(),
            }
            if let Some(initializer) = member.init() {
                this.field("initializer");
                this.expr(initializer);
            }
            this.close();
        });
        self.close();
        self.close();
    }
}
