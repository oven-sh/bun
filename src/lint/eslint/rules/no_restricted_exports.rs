use bun_lint::prelude::*;

/// Disallow specified names in exports.
pub struct NoRestrictedExports {
    restricted_names: Vec<Box<[u8]>>,
    restricted_name_pattern: Option<Regex>,
    /// `export default ..`
    direct: bool,
    /// `export { a as default }`
    named: bool,
    /// `export { default } from "m"`
    default_from: bool,
    /// `export { a as default } from "m"`
    named_from: bool,
    /// `export * as default from "m"`
    namespace_from: bool,
}

const RESTRICTED_NAMED: Message = Message::new(
    "restrictedNamed",
    "'{{name}}' is restricted from being used as an exported name.",
);
const RESTRICTED_DEFAULT: Message =
    Message::new("restrictedDefault", "Exporting 'default' is restricted.");

/// Whether `binding` is the first in `declarations` that binds its name.
fn is_first_binding_of_name<'a>(declarations: List<'a, VarDecl<'a>>, binding: Pat<'a>) -> bool {
    let mut first = None;
    for declaration in declarations {
        declaration.pat().for_each_binding(&mut |it| {
            if first.is_none() && it.as_ident() == binding.as_ident() {
                first = Some(it);
            }
        });
    }
    first == Some(binding)
}

impl NoRestrictedExports {
    fn is_restricted_name(&self, name: Name) -> bool {
        let name = name.bytes();
        self.restricted_names.iter().any(|it| **it == *name)
            || name != b"default" && self.restricted_name_pattern.as_ref().is_some_and(|it| it.test(name))
    }

    /// `name`, which is written at `at`, is exported and cannot be `default`.
    fn check_declared_name<'a>(&self, name: Name<'a>, at: Span, cx: &Cx<'a, Self>) {
        if self.is_restricted_name(name) {
            cx.report(at, RESTRICTED_NAMED).data("name", name);
        }
    }

    /// `restricts_default`: whether this way of exporting something as `default` is restricted.
    fn check_exported_name<'a>(&self, exported: Ident<'a>, restricts_default: bool, cx: &Cx<'a, Self>) {
        if self.is_restricted_name(exported.name()) {
            cx.report(exported, RESTRICTED_NAMED).data("name", exported);
        } else if restricts_default && exported.name().is("default") {
            cx.report(exported, RESTRICTED_DEFAULT);
        }
    }

    fn check_specifier<'a>(&self, specifier: ExportSpec<'a>, cx: &mut Cx<'a, Self>) {
        let restricts_default = match specifier.export().has_from() {
            false => self.named,
            true if specifier.local().name().is("default") => self.default_from,
            true => self.named_from,
        };
        self.check_exported_name(specifier.exported(), restricts_default, cx);
    }

    fn check_statement<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let kind = statement.kind();
        match kind {
            StmtKind::ExportStar { alias, .. } => {
                if let Some(alias) = alias {
                    self.check_exported_name(alias, self.namespace_from, cx);
                }
                return;
            }
            StmtKind::ExportDefault(_) => {
                if self.direct {
                    cx.report(statement, RESTRICTED_DEFAULT);
                }
                return;
            }
            _ => {}
        }
        let flags = statement.flags();
        if !flags.contains(Flags::EXPORT) {
            return;
        }
        if flags.contains(Flags::DEFAULT) {
            if self.direct
                && let Some(export) = statement.export_span()
            {
                cx.report(export, RESTRICTED_DEFAULT);
            }
            return;
        }
        match kind {
            // Without a body it is a `TSDeclareFunction`.
            StmtKind::Fn(func) if func.has_body() => {
                if let Some(name) = func.name() {
                    self.check_declared_name(name.name(), name.span(), cx);
                }
            }
            StmtKind::Class(class) => {
                if let Some(name) = class.name() {
                    self.check_declared_name(name.name(), name.span(), cx);
                }
            }
            StmtKind::Var(declarations) => {
                for declaration in declarations {
                    declaration.pat().for_each_binding(&mut |binding| {
                        let Some(name) = binding.as_ident() else {
                            return;
                        };
                        if !self.is_restricted_name(name) || !is_first_binding_of_name(declarations, binding) {
                            return;
                        }
                        // The type annotation is part of the `Identifier`.
                        let at = match binding == declaration.pat() {
                            true => declaration.binding_span(),
                            false => binding.span(),
                        };
                        cx.report(at, RESTRICTED_NAMED).data("name", name);
                    });
                }
            }
            _ => {}
        }
    }
}

impl Rule for NoRestrictedExports {
    const META: Meta = Meta::eslint("no-restricted-exports", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let restrict_default_exports = options.object("restrictDefaultExports");
        let restricts = |key: &str| restrict_default_exports.bool_or(key, false);
        NoRestrictedExports {
            restricted_names: options
                .strings("restrictedNamedExports")
                .into_iter()
                .map(|name| name.as_bytes().into())
                .collect(),
            restricted_name_pattern: match options.str("restrictedNamedExportsPattern") {
                None | Some("") => None,
                Some(pattern) => Regex::new(pattern, "u").ok(),
            },
            direct: restricts("direct"),
            named: restricts("named"),
            default_from: restricts("defaultFrom"),
            named_from: restricts("namedFrom"),
            namespace_from: restricts("namespaceFrom"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        let restricts_names = !self.restricted_names.is_empty() || self.restricted_name_pattern.is_some();
        if restricts_names || self.named || self.default_from || self.named_from {
            on.export_specs(Self::check_specifier);
        }
        if restricts_names || self.namespace_from {
            on.stmts([StmtTag::ExportStar], Self::check_statement);
        }
        if self.direct {
            on.stmts([StmtTag::ExportDefault, StmtTag::Interface], Self::check_statement);
        }
        if restricts_names || self.direct {
            on.stmts([StmtTag::Fn, StmtTag::Class], Self::check_statement);
        }
        if restricts_names {
            on.stmts([StmtTag::Var], Self::check_statement);
        }
    }
}
