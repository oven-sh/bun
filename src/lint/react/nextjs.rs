//! oxlint's `utils/nextjs.rs`, plus its `utils/url.rs`, which only the `nextjs` rules use.
//!
//! A `file_path` is the file's absolute path, as in oxlint.

use bun_core::strings;
use bun_lint::prelude::*;

/// Sorted.
const NEXT_POLYFILLED_FEATURES: [&str; 63] = [
    "Array.from",
    "Array.of",
    "Array.prototype.@@iterator",
    "Array.prototype.at",
    "Array.prototype.copyWithin",
    "Array.prototype.fill",
    "Array.prototype.find",
    "Array.prototype.findIndex",
    "Array.prototype.flat",
    "Array.prototype.flatMap",
    "Array.prototype.includes",
    "Function.prototype.name",
    "Map",
    "Number.EPSILON",
    "Number.Epsilon",
    "Number.MAX_SAFE_INTEGER",
    "Number.MIN_SAFE_INTEGER",
    "Number.isFinite",
    "Number.isInteger",
    "Number.isNaN",
    "Number.isSafeInteger",
    "Number.parseFloat",
    "Number.parseInt",
    "Object.assign",
    "Object.entries",
    "Object.fromEntries",
    "Object.getOwnPropertyDescriptor",
    "Object.getOwnPropertyDescriptors",
    "Object.is",
    "Object.keys",
    "Object.values",
    "Promise",
    "Promise.prototype.finally",
    "Reflect",
    "Set",
    "String.fromCodePoint",
    "String.prototype.@@iterator",
    "String.prototype.codePointAt",
    "String.prototype.endsWith",
    "String.prototype.includes",
    "String.prototype.padEnd",
    "String.prototype.padStart",
    "String.prototype.repeat",
    "String.prototype.startsWith",
    "String.prototype.trimEnd",
    "String.prototype.trimStart",
    "String.raw",
    "Symbol",
    "Symbol.asyncIterator",
    "URL",
    "URL.prototype.toJSON",
    "URLSearchParams",
    "WeakMap",
    "WeakSet",
    "es2015",
    "es2016",
    "es2017",
    "es2018",
    "es2019",
    "es5",
    "es6",
    "es7",
    "fetch",
];

/// `NEXT_POLYFILLED_FEATURES.contains(feature)`
pub(crate) fn is_next_polyfilled_feature(feature: &[u8]) -> bool {
    NEXT_POLYFILLED_FEATURES
        .binary_search_by(|it| it.as_bytes().cmp(feature))
        .is_ok()
}

pub(crate) fn is_in_app_dir(file_path: &[u8]) -> bool {
    strings::contains(file_path, b"app/") || strings::contains(file_path, b"app\\")
}

pub(crate) fn is_document_page(file_path: &[u8]) -> bool {
    let page = strings::rsplit_once(file_path, b"pages").map_or(file_path, |it| it.1);
    page.starts_with(b"/_document") || page.starts_with(b"\\_document")
}

/// Returns the first local name that the file imports from `next/script`, whichever export it is.
pub(crate) fn get_next_script_import_local_name<'a>(file: &'a File<'a>) -> Option<Name<'a>> {
    file.body().iter().find_map(|stmt| match stmt.kind() {
        StmtKind::Import(import) if import.spec().is("next/script") => {
            let named = import.named().first().map(ImportSpec::local);
            import
                .default()
                .or_else(|| import.namespace())
                .or(named)
                .map(Ident::name)
        }
        _ => None,
    })
}

/// Returns the `<name ..>` elements whose opening tag's identifier refers to the binding `local` of `import`.
pub(crate) fn elements_named<'a>(
    import: Import<'a>,
    local: Ident<'a>,
) -> impl Iterator<Item = (Expr<'a>, Jsx<'a>)> {
    // An element's name is a value, so it can't refer to something `import type` declares.
    let is_type = import.is_type_only()
        || import
            .named()
            .iter()
            .any(|it| it.is_type_only() && it.local().name() == local.name());
    // If the name is declared several times, only the first declaration yields its elements.
    let is_first = |it: &Symbol<'a>| match it.declarations().next() {
        Some(Declaration::ImportDefault(first) | Declaration::ImportNamespace(first)) => {
            first == import
        }
        Some(Declaration::ImportSpec(first)) => first.import() == import,
        _ => false,
    };
    let symbol = Node::Stmt(import.stmt())
        .scope()
        .get_name(local.name())
        .filter(|it| !is_type && is_first(it));
    symbol
        .into_iter()
        .flat_map(Symbol::references)
        .filter_map(|reference| {
            let name = reference.expr()?;
            match name.parent() {
                Node::Expr(element) => match element.kind() {
                    ExprKind::Jsx(jsx) if jsx.tag() == Some(name) => Some((name, jsx)),
                    _ => None,
                },
                _ => None,
            }
        })
}

/// `find_url_query_value("https://example.com/?foo=bar&baz=qux", "baz")` returns `qux`.
pub(crate) fn find_url_query_value<'u>(url: &'u [u8], key: &[u8]) -> Option<&'u [u8]> {
    if !url.starts_with(b"http://") && !url.starts_with(b"https://") {
        return None;
    }
    let query = strings::split(url, b"?").nth(1)?;
    strings::split(query, b"&").find_map(|pair| {
        strings::split_once_char(pair, b'=')
            .filter(|it| it.0 == key)
            .map(|it| it.1)
    })
}
