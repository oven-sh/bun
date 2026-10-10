use crate::bun::{is_end_of_path, list_option};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::ast_util::static_string;

/// Require a package to be imported through the module of the project that wraps it.
pub struct PreferLocalModule {
    modules: Box<[Wrapped]>,
    exempt_files: Box<[Box<[u8]>]>,
}

/// An element of `modules`.
struct Wrapped {
    package: Box<[u8]>,
    /// `use`: the specifier to write.
    module: Box<[u8]>,
    /// `default`: the name under which the module exports what the package exports as its default.
    default: Option<Box<[u8]>>,
    /// `names`: the names of the package that are others in the module, each with the other.
    names: Box<[(Box<[u8]>, Box<[u8]>)]>,
}

const DIRECT_IMPORT: Message = Message::new("directImport", "Import `{{package}}` through `{{module}}`.");

impl Wrapped {
    fn exports_the_same_names(&self) -> bool {
        self.default.is_none() && self.names.is_empty()
    }

    /// What the module calls what the package calls `name`.
    fn name_for<'n>(&'n self, name: &'n [u8]) -> &'n [u8] {
        self.names.iter().find(|it| *it.0 == *name).map_or(name, |it| &*it.1)
    }

    /// `name`, `name as local`
    fn specifier(name: &[u8], local: &[u8]) -> Vec<u8> {
        if name == local { name.to_vec() } else { [name, b" as ", local].concat() }
    }

    /// What is between `import` and `from` to import the same from the module. `None`: that cannot be written.
    fn clause(&self, import: Import) -> Option<Vec<u8>> {
        if import.namespace().is_some() || import.is_type_only() {
            return None;
        }
        let renamed_default = import.default().zip(self.default.as_deref());
        let mut named: Vec<Vec<u8>> = Vec::new();
        named.extend(renamed_default.map(|(local, name)| Wrapped::specifier(name, local.bytes())));
        named.extend(import.named().iter().map(|it| {
            let specifier = Wrapped::specifier(self.name_for(it.imported().bytes()), it.local().bytes());
            if it.is_type_only() { [&b"type "[..], &specifier].concat() } else { specifier }
        }));
        let braces = [&b"{ "[..], &named.join(&b", "[..]), b" }"].concat();
        Some(match import.default().filter(|_| self.default.is_none()) {
            Some(default) if named.is_empty() => default.bytes().to_vec(),
            Some(default) => [default.bytes(), b", ", &braces].concat(),
            None => braces,
        })
    }

    /// Reports the specifier at `span`. `import`: the statement, if it is an `import`: the fix can write more of it.
    fn report<'a>(&self, span: Span, import: Option<Import<'a>>, cx: &Cx<'a, PreferLocalModule>) {
        let report = cx.report(span, DIRECT_IMPORT).data("package", self.package.to_vec());
        report.data("module", self.module.to_vec()).fix(|fixer| {
            // In the quotes that are there.
            let quote = fixer.file().slice(span).get(..1)?;
            let specifier = fixer.replace(span, [quote, &self.module, quote].concat());
            match import.filter(|it| !self.exports_the_same_names() && !it.is_side_effect()) {
                Some(import) => Some(vec![fixer.replace(import.clause_span(), self.clause(import)?), specifier]),
                None if import.is_some() || self.exports_the_same_names() => Some(vec![specifier]),
                None => None,
            }
        });
    }
}

impl PreferLocalModule {
    fn wrapped(&self, specifier: Name) -> Option<&Wrapped> {
        self.modules.iter().find(|it| *it.package == *specifier.bytes())
    }
}

impl Rule for PreferLocalModule {
    const META: Meta = Meta::plugin(Plugin::Bun, "prefer-local-module", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new()
        .stmts(&[StmtTag::Import, StmtTag::ExportNamed, StmtTag::ExportStar])
        .exprs(&[ExprTag::ImportCall, ExprTag::Call]);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let bytes = |text: &str| -> Box<[u8]> { text.as_bytes().into() };
        let modules = options.object(0).array("modules").iter().filter_map(|it| {
            let module = Object::of(Some(it));
            let names = module.object("names").entries().iter();
            let names = names.filter_map(|(name, other)| Some((name.as_slice().into(), other.as_str()?.into())));
            Some(Wrapped {
                package: bytes(module.str("package")?),
                module: bytes(module.str("use")?),
                default: module.str("default").map(bytes),
                names: names.collect(),
            })
        });
        PreferLocalModule { modules: modules.collect(), exempt_files: list_option(options, "exemptFiles", &[]) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        if self.exempt_files.iter().any(|it| is_end_of_path(file.path(), it)) {
            return None;
        }
        Some(())
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let (specifier, import) = match statement.kind() {
            StmtKind::Import(import) => (Some(import.spec()), Some(import)),
            StmtKind::ExportNamed(export) => (export.spec(), None),
            StmtKind::ExportStar { spec, .. } => (spec, None),
            _ => (None, None),
        };
        if let Some(wrapped) = specifier.and_then(|it| self.wrapped(it))
            && let Some(span) = statement.module_specifier_span()
        {
            wrapped.report(span, import, cx);
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let specifier = match e.kind() {
            ExprKind::ImportCall { args } => args.first(),
            ExprKind::Call(call) if call.callee().is_ident("require") => call.args().first(),
            _ => None,
        };
        if let Some(specifier) = specifier.filter(|it| it.tag() == ExprTag::String)
            && let Some(wrapped) = static_string(specifier).and_then(|it| self.wrapped(it))
        {
            wrapped.report(specifier.span(), None, cx);
        }
    }
}
