//! Type syntax.

use super::Converter;
use crate::ast::{
    Expr, ExprKind, Flags, FnKind, Keyword, List, Mapped, MappedModifier, TupleElem, TypeKind,
    TypeNode, TypeParam,
};
use crate::estree::NodeType::*;
use crate::estree::Sink;
use crate::span::Span;

impl<'a, S: Sink> Converter<'a, '_, S> {
    /// The field `name` with a `TSTypeAnnotation` of `ty`, if there is one.
    pub(super) fn type_annotation(&mut self, name: &'static str, ty: Option<TypeNode<'a>>) {
        let Some(ty) = ty else {
            return;
        };
        self.field(name);
        self.open(TSTypeAnnotation, ty.annotation_span());
        self.field("typeAnnotation");
        self.ty(ty);
        self.close();
    }

    /// The field `name` with the type arguments, if there are any.
    pub(super) fn type_arguments(&mut self, name: &'static str, arguments: List<'a, TypeNode<'a>>) {
        let Some(span) = arguments.angle_brackets_span() else {
            return;
        };
        self.field(name);
        self.open(TSTypeParameterInstantiation, span);
        self.list("params", arguments, Self::ty);
        self.close();
    }

    /// The field `typeParameters`, if there are any.
    pub(super) fn type_parameters(&mut self, parameters: List<'a, TypeParam<'a>>) {
        let Some(span) = parameters.angle_brackets_span() else {
            return;
        };
        self.field("typeParameters");
        self.open(TSTypeParameterDeclaration, span);
        self.list("params", parameters, Self::type_parameter);
        self.close();
    }

    fn type_parameter(&mut self, parameter: TypeParam<'a>) {
        let flags = parameter.flags();
        self.open(TSTypeParameter, parameter.span());
        self.flag("const", flags.contains(Flags::CONST));
        if let Some(constraint) = parameter.constraint() {
            self.field("constraint");
            self.ty(constraint);
        }
        if let Some(default) = parameter.default() {
            self.field("default");
            self.ty(default);
        }
        self.flag("in", flags.contains(Flags::IN));
        self.field("name");
        self.ident(parameter.name());
        self.flag("out", flags.contains(Flags::OUT));
        self.close();
    }

    pub(super) fn ty(&mut self, ty: TypeNode<'a>) {
        if !self.can_descend() {
            return;
        }
        let span = ty.span();
        match ty.kind() {
            TypeKind::Error | TypeKind::Heritage { .. } => self.out.null(),
            TypeKind::Keyword(keyword) => {
                let node_type = match keyword {
                    Keyword::Any => TSAnyKeyword,
                    Keyword::Unknown => TSUnknownKeyword,
                    Keyword::Never => TSNeverKeyword,
                    Keyword::Void => TSVoidKeyword,
                    Keyword::Undefined => TSUndefinedKeyword,
                    Keyword::Null => TSNullKeyword,
                    Keyword::String => TSStringKeyword,
                    Keyword::Number => TSNumberKeyword,
                    Keyword::Boolean => TSBooleanKeyword,
                    Keyword::BigInt => TSBigIntKeyword,
                    Keyword::Symbol => TSSymbolKeyword,
                    Keyword::Object => TSObjectKeyword,
                    Keyword::This => TSThisType,
                    Keyword::Intrinsic => TSIntrinsicKeyword,
                };
                self.leaf(node_type, span);
            }
            TypeKind::Ref { name, args } => {
                self.open(TSTypeReference, span);
                self.type_arguments("typeArguments", args);
                self.field("typeName");
                self.entity_name(name, TSQualifiedName);
                self.close();
            }
            TypeKind::StringLit(value) => {
                self.open(TSLiteralType, span);
                self.field("literal");
                match self.file.slice(span).starts_with(b"`") {
                    true => self.plain_template(span, Some(value.bytes())),
                    false => self.string_literal(span, value.bytes()),
                }
                self.close();
            }
            TypeKind::NumberLit(value) => {
                self.open(TSLiteralType, span);
                self.field("literal");
                self.signed(span, |this, span| this.number_literal(span, value.abs()));
                self.close();
            }
            TypeKind::BigIntLit { text, .. } => {
                self.open(TSLiteralType, span);
                self.field("literal");
                self.signed(span, |this, span| this.bigint_literal(span, text.bytes()));
                self.close();
            }
            TypeKind::BoolLit(value) => {
                self.open(TSLiteralType, span);
                self.field("literal");
                self.open(Literal, span);
                self.text("raw", if value { b"true" } else { b"false" });
                self.flag("value", value);
                self.close();
                self.close();
            }
            TypeKind::Template(types) => {
                self.open(TSTemplateLiteralType, span);
                if let Some(template) = ty.as_template() {
                    let count = template.quasi_count();
                    self.list("quasis", 0..count, |this, i| {
                        let cooked = template.cooked(i).map(|it| it.bytes());
                        this.template_element(template.quasi_span(i), i + 1 == count, cooked, template.raw(i));
                    });
                }
                self.list("types", types, Self::ty);
                self.close();
            }
            TypeKind::Array(element) => {
                self.open(TSArrayType, span);
                self.field("elementType");
                self.ty(element);
                self.close();
            }
            TypeKind::Tuple(elements) => {
                self.open(TSTupleType, span);
                self.list("elementTypes", elements, Self::tuple_element);
                self.close();
            }
            TypeKind::Union(types) => {
                self.open(TSUnionType, span);
                self.list("types", types, Self::ty);
                self.close();
            }
            TypeKind::Intersection(types) => {
                self.open(TSIntersectionType, span);
                self.list("types", types, Self::ty);
                self.close();
            }
            TypeKind::Fn(func) => {
                let is_constructor = func.kind() == FnKind::ConstructorType;
                self.open(if is_constructor { TSConstructorType } else { TSFunctionType }, span);
                if is_constructor {
                    self.flag("abstract", func.flags().contains(Flags::ABSTRACT));
                }
                self.signature(func, true);
                self.close();
            }
            TypeKind::Object(members) => {
                self.open(TSTypeLiteral, span);
                self.list("members", members, Self::type_member);
                self.close();
            }
            TypeKind::Cond {
                check,
                extends,
                yes,
                no,
            } => {
                self.open(TSConditionalType, span);
                self.field("checkType");
                self.ty(check);
                self.field("extendsType");
                self.ty(extends);
                self.field("trueType");
                self.ty(yes);
                self.field("falseType");
                self.ty(no);
                self.close();
            }
            TypeKind::Infer(parameter) => {
                self.open(TSInferType, span);
                self.field("typeParameter");
                self.type_parameter(parameter);
                self.close();
            }
            TypeKind::Mapped(mapped) => self.mapped(span, mapped),
            TypeKind::IndexedAccess { obj, index } => {
                self.open(TSIndexedAccessType, span);
                self.field("objectType");
                self.ty(obj);
                self.field("indexType");
                self.ty(index);
                self.close();
            }
            TypeKind::Keyof(operand) | TypeKind::Readonly(operand) => {
                let is_keyof = matches!(ty.kind(), TypeKind::Keyof(_));
                self.open(TSTypeOperator, span);
                self.text("operator", if is_keyof { b"keyof" } else { b"readonly" });
                self.field("typeAnnotation");
                self.ty(operand);
                self.close();
            }
            TypeKind::UniqueSymbol => {
                self.open(TSTypeOperator, span);
                self.text("operator", b"unique");
                self.field("typeAnnotation");
                self.leaf(TSSymbolKeyword, ty.unique_symbol_keyword_span().unwrap_or(span));
                self.close();
            }
            TypeKind::Typeof { expr, args } => {
                self.open(TSTypeQuery, span);
                self.field("exprName");
                self.type_query_name(expr);
                self.type_arguments("typeArguments", args);
                self.close();
            }
            TypeKind::Import { is_typeof, .. } => {
                if is_typeof {
                    self.open(TSTypeQuery, span);
                    self.field("exprName");
                }
                self.import_type(ty);
                if is_typeof {
                    self.close();
                }
            }
            TypeKind::Predicate { ty: asserted, asserts, .. } => {
                self.open(TSTypePredicate, span);
                self.flag("asserts", asserts);
                self.field("parameterName");
                match ty.predicate_param() {
                    Some(name) if name.name().is("this") => self.leaf(TSThisType, name.span()),
                    Some(name) => self.ident(name),
                    None => self.out.null(),
                }
                self.field("typeAnnotation");
                match asserted {
                    Some(asserted) => {
                        self.open(TSTypeAnnotation, asserted.span());
                        self.field("typeAnnotation");
                        self.ty(asserted);
                        self.close();
                    }
                    None => self.out.null(),
                }
                self.close();
            }
        }
    }

    /// A numeric literal at `span`, which can have a `-` before it.
    fn signed(&mut self, span: Span, literal: impl FnOnce(&mut Self, Span)) {
        if !self.file.slice(span).starts_with(b"-") {
            return literal(self, span);
        }
        self.open(UnaryExpression, span);
        self.field("argument");
        let start = crate::tokens::skip_trivia(self.file.text(), span.start + 1);
        literal(self, Span::new(start, span.end));
        self.text("operator", b"-");
        self.flag("prefix", true);
        self.close();
    }

    /// The `a.b.c` of `typeof a.b.c`.
    fn type_query_name(&mut self, e: Expr<'a>) {
        match e.kind() {
            ExprKind::Dot { obj, name, .. } => {
                self.open(TSQualifiedName, e.span());
                self.field("left");
                self.type_query_name(obj);
                self.field("right");
                self.ident(name);
                self.close();
            }
            _ => self.expr(e),
        }
    }

    fn tuple_element(&mut self, element: TupleElem<'a>) {
        let span = element.span();
        if element.is_rest() {
            self.open(TSRestType, span);
            self.field("typeAnnotation");
        }
        match element.name() {
            Some(name) => {
                self.open(TSNamedTupleMember, Span::new(name.span().start, span.end));
                self.field("elementType");
                self.ty(element.ty());
                self.field("label");
                self.ident(name);
                self.flag("optional", element.is_optional());
                self.close();
            }
            None if element.is_optional() => {
                self.open(TSOptionalType, span);
                self.field("typeAnnotation");
                self.ty(element.ty());
                self.close();
            }
            None => self.ty(element.ty()),
        }
        if element.is_rest() {
            self.close();
        }
    }

    fn mapped(&mut self, span: Span, mapped: Mapped<'a>) {
        let parameter = mapped.param();
        self.open(TSMappedType, span);
        self.field("constraint");
        match parameter.constraint() {
            Some(constraint) => self.ty(constraint),
            None => self.out.null(),
        }
        self.field("key");
        self.ident(parameter.name());
        self.field("nameType");
        match mapped.name_type() {
            Some(name) => self.ty(name),
            None => self.out.null(),
        }
        self.field("optional");
        match mapped.optional() {
            MappedModifier::None => self.out.boolean(false),
            MappedModifier::Add if mapped.is_optional_with_plus() => self.out.string(b"+"),
            MappedModifier::Add => self.out.boolean(true),
            MappedModifier::Remove => self.out.string(b"-"),
        }
        match mapped.readonly() {
            MappedModifier::None => {}
            MappedModifier::Add if mapped.is_readonly_with_plus() => self.text("readonly", b"+"),
            MappedModifier::Add => self.flag("readonly", true),
            MappedModifier::Remove => self.text("readonly", b"-"),
        }
        if let Some(ty) = mapped.ty() {
            self.field("typeAnnotation");
            self.ty(ty);
        }
        self.close();
    }

    /// `import("spec", { with: { .. } }).A.B<Args>`
    fn import_type(&mut self, ty: TypeNode<'a>) {
        let TypeKind::Import { spec, name, args, .. } = ty.kind() else {
            return self.out.null();
        };
        self.open(TSImportType, ty.import_span().unwrap_or_default());
        self.field("source");
        match (spec, ty.import_source_span()) {
            (Some(spec), Some(span)) => self.string_literal(span, spec.bytes()),
            _ => self.out.null(),
        }
        self.field("options");
        match ty.import_attributes() {
            Some(attributes) => {
                let (keyword, braces) = (attributes.keyword_span(), attributes.braces_span());
                self.open(ObjectExpression, attributes.options_span());
                self.field("properties");
                self.out.start_list();
                self.open(Property, keyword.to(braces));
                self.flag("computed", false);
                self.field("key");
                self.identifier(self.file.slice(keyword), keyword);
                self.property_tail();
                self.field("value");
                self.open(ObjectExpression, braces);
                self.list("properties", attributes.entries(), |this, entry| {
                    this.open(Property, entry.span());
                    this.flag("computed", false);
                    this.field("key");
                    match entry.key() {
                        Some(key) => this.key_value(key),
                        None => this.out.null(),
                    }
                    this.property_tail();
                    this.field("value");
                    this.opt_expr(entry.value());
                    this.close();
                });
                self.close();
                self.close();
                self.out.end_list();
                self.close();
            }
            None => self.out.null(),
        }
        self.field("qualifier");
        self.entity_name(name, TSQualifiedName);
        match args.is_empty() {
            true => self.null("typeArguments"),
            false => self.type_arguments("typeArguments", args),
        }
        self.close();
    }

    /// The fields of a plain `key: value`.
    fn property_tail(&mut self) {
        self.text("kind", b"init");
        self.flag("method", false);
        self.flag("optional", false);
        self.flag("shorthand", false);
    }
}
