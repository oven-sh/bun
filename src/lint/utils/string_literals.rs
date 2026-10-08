//! The strings that are nodes for ESLint and not expressions here.
//!
//! A rule with a `Literal` or a `TemplateLiteral` listener that looks at strings is also called
//! with the key `"a"` of `{ "a": 1 }`, the `"m"` of `import "m"`, the type `"a"`. Here those are
//! parts of a `Prop`, a `Stmt`, a `TypeNode`. Such a rule listens for `ExprTag::String` and
//! `ExprTag::Template`, implements [`StringLiterals`] and calls [`on_string_literals`] for the rest.

use super::estree_compat::estree_type_name;
use crate::ast::{
    File, Ident, ImportAttributes, Key, KeyKind, ModuleName, Node, PatKind, PatTag, StmtKind,
    StmtTag, TypeTag,
};
use crate::context::Cx;
use crate::rule::{Listeners, Rule};
use crate::span::{Span, Spanned};

/// What a [`StringLiteral`] is in its owner.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum StringLiteralRole {
    /// `"a": 1`, `"a"() {}`, `"a" = 1` in an enum. The owner is a `Prop`, a `PatProp`, a `Member` or
    /// an `EnumMember`.
    Key,
    /// `["a"]: 1`, `` [`a`]: 1 ``. The same owners.
    ComputedKey,
    /// `from "m"`, `import "m"`, `require("m")` in `import a = require("m")`. The owner is the
    /// `Stmt`.
    Source,
    /// `import { "a" as b }`, `export { a as "b" }`, `export * as "a" from "m"`. The owner is an
    /// `ImportSpec`, an `ExportSpec` or the `Stmt`.
    ModuleExportName,
    /// `declare module "m"`. The owner is the `Stmt`.
    ModuleName,
    /// The `"type"` of `with { "type": "json" }`. The owner is the `Stmt`, or the `TypeNode` of an
    /// import type. The value is an expression.
    AttributeKey,
    /// The type `"a"` or `` `a` ``. The owner is the `TypeNode`.
    Type,
    /// The `"m"` of the type `import("m")`. The owner is the `TypeNode`.
    ImportTypeSource,
    /// A `TemplateElement` of the type `` `a${T}b` ``, with its delimiters. The owner is the
    /// `TypeNode`.
    TypeTemplateElement,
}

/// A `Literal` with a string value, a `TemplateLiteral` without substitutions or a
/// `TemplateElement` of ESTree that is not an expression here, nor part of one.
#[derive(Copy, Clone, Debug)]
pub struct StringLiteral<'a> {
    /// With the quotes or the backticks.
    pub span: Span,
    /// The node that it is a part of.
    pub owner: Node<'a>,
    pub role: StringLiteralRole,
}

impl<'a> StringLiteral<'a> {
    #[inline]
    pub fn file(&self) -> &'a File<'a> {
        self.owner.file()
    }

    /// ESTree's `raw`: as it is written, with the quotes or the backticks.
    #[inline]
    pub fn text(&self) -> &'a [u8] {
        self.file().slice(self.span)
    }

    /// It is written with backticks: a `TemplateLiteral`, not a `Literal`.
    #[inline]
    pub fn is_template(&self) -> bool {
        self.role != StringLiteralRole::TypeTemplateElement && self.text().starts_with(b"`")
    }

    /// ESTree's `node.parent.type`.
    pub fn estree_parent_type(&self) -> &'static str {
        match self.role {
            StringLiteralRole::Key
            | StringLiteralRole::ComputedKey
            | StringLiteralRole::ModuleExportName
            | StringLiteralRole::ModuleName => estree_type_name(self.owner),
            StringLiteralRole::Source => match estree_type_name(self.owner) {
                "TSImportEqualsDeclaration" => "TSExternalModuleReference",
                name => name,
            },
            StringLiteralRole::AttributeKey => "ImportAttribute",
            StringLiteralRole::Type => "TSLiteralType",
            StringLiteralRole::ImportTypeSource => "TSImportType",
            StringLiteralRole::TypeTemplateElement => "TSTemplateLiteralType",
        }
    }
}

impl Spanned for StringLiteral<'_> {
    #[inline]
    fn span(&self) -> Span {
        self.span
    }
}

/// A rule that looks at all the strings of a file.
pub trait StringLiterals: Rule {
    /// Called with every string that is not an `ExprKind::String` or an `ExprKind::Template`, in no
    /// particular order.
    fn string_literal<'a>(&self, literal: StringLiteral<'a>, cx: &mut Cx<'a, Self>);
}

fn key<'a, R: StringLiterals>(rule: &R, key: Option<Key<'a>>, owner: Node<'a>, cx: &mut Cx<'a, R>) {
    let Some(key) = key else {
        return;
    };
    let role = match key.kind() {
        KeyKind::String(_) => StringLiteralRole::Key,
        KeyKind::ComputedString(_) => StringLiteralRole::ComputedKey,
        _ => return,
    };
    let span = key.inner_span(owner.file());
    rule.string_literal(StringLiteral { span, owner, role }, cx);
}

fn name<'a, R: StringLiterals>(
    rule: &R,
    name: Option<Ident<'a>>,
    owner: Node<'a>,
    role: StringLiteralRole,
    cx: &mut Cx<'a, R>,
) {
    if let Some(name) = name.filter(|it| it.is_string()) {
        let span = name.span();
        rule.string_literal(StringLiteral { span, owner, role }, cx);
    }
}

fn attributes<'a, R: StringLiterals>(
    rule: &R,
    attributes: Option<ImportAttributes<'a>>,
    owner: Node<'a>,
    cx: &mut Cx<'a, R>,
) {
    for entry in attributes.into_iter().flat_map(ImportAttributes::entries) {
        if let Some(key) = entry
            .key()
            .filter(|it| matches!(it.kind(), KeyKind::String(_)))
        {
            let (span, role) = (
                key.inner_span(owner.file()),
                StringLiteralRole::AttributeKey,
            );
            rule.string_literal(StringLiteral { span, owner, role }, cx);
        }
    }
}

/// Registers what calls [`StringLiterals::string_literal`].
pub fn on_string_literals<'a, R: StringLiterals>(on: &mut Listeners<'a, R>) {
    on.props(|rule, prop, cx| key(rule, prop.key(), prop.into(), cx));
    on.enum_members(|rule, member, cx| key(rule, member.key(), member.into(), cx));
    on.members(|rule, member, cx| {
        key(rule, member.key(), member.into(), cx);
        let keyword = member.constructor_keyword();
        name(rule, keyword, member.into(), StringLiteralRole::Key, cx);
    });
    on.pats([PatTag::Object], |rule, pat, cx| {
        if let PatKind::Object(props) = pat.kind() {
            props
                .iter()
                .for_each(|prop| key(rule, prop.key(), prop.into(), cx));
        }
    });
    on.import_specs(|rule, specifier, cx| {
        let imported = Some(specifier.imported());
        name(
            rule,
            imported,
            specifier.into(),
            StringLiteralRole::ModuleExportName,
            cx,
        );
    });
    on.export_specs(|rule, specifier, cx| {
        let role = StringLiteralRole::ModuleExportName;
        name(rule, Some(specifier.local()), specifier.into(), role, cx);
        if specifier.is_renamed() {
            name(rule, Some(specifier.exported()), specifier.into(), role, cx);
        }
    });
    on.stmts(
        [
            StmtTag::Import,
            StmtTag::ExportNamed,
            StmtTag::ExportStar,
            StmtTag::ImportEquals,
            StmtTag::Module,
        ],
        |rule, statement, cx| {
            let owner = Node::Stmt(statement);
            match statement.kind() {
                StmtKind::Module(module) => {
                    if let ModuleName::String(written) = module.name() {
                        name(
                            rule,
                            Some(written),
                            owner,
                            StringLiteralRole::ModuleName,
                            cx,
                        );
                    }
                    return;
                }
                StmtKind::ExportStar { alias, .. } => {
                    name(rule, alias, owner, StringLiteralRole::ModuleExportName, cx);
                }
                _ => {}
            }
            if let Some(span) = statement.module_specifier_span() {
                let role = StringLiteralRole::Source;
                rule.string_literal(StringLiteral { span, owner, role }, cx);
            }
            attributes(rule, statement.import_attributes(), owner, cx);
        },
    );
    on.types(
        [TypeTag::StringLit, TypeTag::Import, TypeTag::Template],
        |rule, ty, cx| {
            let owner = Node::Type(ty);
            let mut call = |span: Span, role: StringLiteralRole| {
                rule.string_literal(StringLiteral { span, owner, role }, cx);
            };
            match ty.tag() {
                TypeTag::StringLit => call(ty.span(), StringLiteralRole::Type),
                TypeTag::Template => {
                    if let Some(template) = ty.as_template() {
                        for i in 0..template.quasi_count() {
                            call(
                                template.quasi_span(i),
                                StringLiteralRole::TypeTemplateElement,
                            );
                        }
                    }
                }
                _ => {
                    if let Some(span) = ty.import_source_span() {
                        call(span, StringLiteralRole::ImportTypeSource);
                    }
                    attributes(rule, ty.import_attributes(), owner, cx);
                }
            }
        },
    );
}
