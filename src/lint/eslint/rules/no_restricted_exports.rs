use bun_lint::prelude::*;
use rustc_hash::FxHashSet;

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
/// What oxlint says instead where it is not `export default`.
const RESTRICTED_NAMED_AS_DEFAULT: Message =
    Message::new("restrictedDefault", "Exporting named value as default is restricted.");
const RESTRICTED_DEFAULT_FROM: Message =
    Message::new("restrictedDefault", "Reexporting 'default' export is restricted.");
const RESTRICTED_NAMED_FROM: Message =
    Message::new("restrictedDefault", "Reexporting named export as default is restricted.");
const RESTRICTED_NAMESPACE_FROM: Message =
    Message::new("restrictedDefault", "Reexporting namespace as default is restricted.");

impl NoRestrictedExports {
    fn is_restricted_name(&self, name: Name) -> bool {
        let name = name.bytes();
        self.restricted_names.iter().any(|it| **it == *name)
            || name != b"default" && self.restricted_name_pattern.as_ref().is_some_and(|it| it.test(name))
    }

    /// `name`, which is written at `at`, is exported by `statement` and cannot be `default`. oxlint points at the statement.
    fn check_declared_name<'a>(&self, name: Name<'a>, at: Span, statement: Stmt<'a>, cx: &Cx<'a, Self>) {
        if self.is_restricted_name(name) {
            let place = if cx.language().is_oxlint { statement.span() } else { at };
            cx.report(place, RESTRICTED_NAMED).data("name", name);
        }
    }

    /// `restricts_default`: whether this way of exporting something as `default` is restricted. `said_by_oxlint`: what
    /// oxlint says then.
    fn check_exported_name<'a>(
        &self,
        exported: Ident<'a>,
        (restricts_default, said_by_oxlint): (bool, Message),
        statement: Stmt<'a>,
        cx: &Cx<'a, Self>,
    ) {
        let place = if cx.language().is_oxlint { statement.span() } else { exported.span() };
        if self.is_restricted_name(exported.name()) {
            cx.report(place, RESTRICTED_NAMED).data("name", exported);
        } else if restricts_default && exported.name().is("default") {
            cx.report(place, if cx.language().is_oxlint { said_by_oxlint } else { RESTRICTED_DEFAULT });
        }
    }

    fn check_specifier<'a>(&self, specifier: ExportSpec<'a>, cx: &mut Cx<'a, Self>) {
        let restricts_default = match specifier.export().has_from() {
            false => (self.named, RESTRICTED_NAMED_AS_DEFAULT),
            true if specifier.local().name().is("default") => (self.default_from, RESTRICTED_DEFAULT_FROM),
            true => (self.named_from, RESTRICTED_NAMED_FROM),
        };
        self.check_exported_name(specifier.exported(), restricts_default, specifier.export().stmt(), cx);
    }

    fn check_statement<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let kind = statement.kind();
        match kind {
            StmtKind::ExportStar { alias, .. } => {
                if let Some(alias) = alias {
                    self.check_exported_name(alias, (self.namespace_from, RESTRICTED_NAMESPACE_FROM), statement, cx);
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
                    self.check_declared_name(name.name(), name.span(), statement, cx);
                }
            }
            StmtKind::Class(class) => {
                if let Some(name) = class.name() {
                    self.check_declared_name(name.name(), name.span(), statement, cx);
                }
            }
            StmtKind::Var(declarations) => {
                // A name is reported where it is bound first.
                let mut reported: FxHashSet<Name<'a>> = FxHashSet::default();
                for declaration in declarations {
                    declaration.pat().for_each_binding(&mut |binding| {
                        let Some(name) = binding.as_ident() else {
                            return;
                        };
                        if !self.is_restricted_name(name) || !reported.insert(name) {
                            return;
                        }
                        // The type annotation is part of the `Identifier`.
                        let at = match binding == declaration.pat() {
                            true => declaration.binding_span(),
                            false => binding.span(),
                        };
                        let place = if cx.language().is_oxlint { statement.span() } else { at };
                        cx.report(place, RESTRICTED_NAMED).data("name", name);
                    });
                }
            }
            _ => {}
        }
    }
}

impl Rule for NoRestrictedExports {
    const META: Meta = Meta::eslint("no-restricted-exports", Kind::Suggestion);
    const ON: On = On::new()
        .export_specs()
        .stmts(&[StmtTag::ExportStar])
        .stmts(&[StmtTag::ExportDefault, StmtTag::Interface])
        .stmts(&[StmtTag::Fn, StmtTag::Class])
        .stmts(&[StmtTag::Var]);
    no_state!();

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

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        let mut on = On::new();
        let restricts_names = !self.restricted_names.is_empty() || self.restricted_name_pattern.is_some();
        if restricts_names || self.named || self.default_from || self.named_from {
            on = on.export_specs();
        }
        if restricts_names || self.namespace_from {
            on = on.stmts(&[StmtTag::ExportStar]);
        }
        if self.direct {
            on = on.stmts(&[StmtTag::ExportDefault, StmtTag::Interface]);
        }
        if restricts_names || self.direct {
            on = on.stmts(&[StmtTag::Fn, StmtTag::Class]);
        }
        if restricts_names {
            on = on.stmts(&[StmtTag::Var]);
        }
        on
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        self.check_statement(statement, cx);
    }

    fn export_spec<'a>(&self, specifier: ExportSpec<'a>, cx: &mut Cx<'a, Self>) {
        self.check_specifier(specifier, cx);
    }
}
