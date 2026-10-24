use super::ImportSiteKind;
use crate::atom::{Atom, known};
use crate::bind::{Bound, Parent};
use crate::fold::Decisions;
use crate::hir::{ExprId, ExprKind, File, JsxId, Prop, PropId, PropKey, PropKind};

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct AutomaticJsx {
    pub runtime_specifier: Atom,
    pub package_specifier: Atom,
    pub is_development: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum JsxMode {
    Classic,
    Automatic(AutomaticJsx),
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub enum JsxImport {
    Jsx,
    Jsxs,
    JsxDev,
    Fragment,
    CreateElement,
}

impl JsxImport {
    pub const ALL: [JsxImport; 5] = [
        JsxImport::Jsx,
        JsxImport::Jsxs,
        JsxImport::JsxDev,
        JsxImport::Fragment,
        JsxImport::CreateElement,
    ];

    pub fn site_kind(self) -> ImportSiteKind {
        match self {
            JsxImport::Jsx | JsxImport::Jsxs | JsxImport::JsxDev | JsxImport::Fragment => {
                ImportSiteKind::JsxRuntime
            }
            JsxImport::CreateElement => ImportSiteKind::JsxPackage,
        }
    }

    pub fn export_name(self) -> &'static [u8] {
        match self {
            JsxImport::Jsx => b"jsx",
            JsxImport::Jsxs => b"jsxs",
            JsxImport::JsxDev => b"jsxDEV",
            JsxImport::Fragment => b"Fragment",
            JsxImport::CreateElement => b"createElement",
        }
    }
}

#[derive(Copy, Clone, Default, PartialEq, Eq, Hash, Debug)]
pub struct JsxImportSet(u8);

impl JsxImportSet {
    pub fn contains(self, import: JsxImport) -> bool {
        self.0 & (1 << import as u8) != 0
    }

    pub fn iter(self) -> impl Iterator<Item = JsxImport> {
        let all = JsxImport::ALL.into_iter();
        all.filter(move |&import| self.contains(import))
    }

    pub fn insert(&mut self, import: JsxImport) {
        self.0 |= 1 << import as u8;
    }

    pub fn is_empty(self) -> bool {
        self.0 == 0
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum JsxCallee {
    Factory,
    Import(JsxImport),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct KeyAttribute {
    pub key: Option<PropId>,
    pub is_after_spread: bool,
}

fn is_named_key(attribute: &Prop) -> bool {
    attribute.kind == PropKind::Init && attribute.key == PropKey::Name(known::key)
}

pub fn jsx_callee(hir: &File<'_>, mode: JsxMode, jsx: JsxId) -> JsxCallee {
    let automatic = match mode {
        JsxMode::Classic => return JsxCallee::Factory,
        JsxMode::Automatic(automatic) => automatic,
    };
    let import = if find_key_attribute(hir, jsx).is_after_spread {
        JsxImport::CreateElement
    } else if automatic.is_development {
        JsxImport::JsxDev
    } else if has_static_children(hir, jsx) {
        JsxImport::Jsxs
    } else {
        JsxImport::Jsx
    };
    JsxCallee::Import(import)
}

pub(super) fn collect_jsx_imports(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
    mode: JsxMode,
) -> JsxImportSet {
    let mut imports = JsxImportSet::default();
    if mode == JsxMode::Classic || hir.jsx.is_empty() {
        return imports;
    }
    for (index, expr) in hir.exprs.iter().enumerate() {
        let ExprKind::Jsx(jsx) = expr.kind else {
            continue;
        };
        let e = ExprId(index as u32);
        if bound.parent_of_expr(e) == Parent::None || decisions.is_dead_expr(e) {
            continue;
        }
        if let JsxCallee::Import(import) = jsx_callee(hir, mode, jsx) {
            imports.insert(import);
        }
        if hir[jsx].tag.is_none() {
            imports.insert(JsxImport::Fragment);
        }
    }
    imports
}

pub fn find_key_attribute(hir: &File<'_>, jsx: JsxId) -> KeyAttribute {
    let mut found = KeyAttribute {
        key: None,
        is_after_spread: false,
    };
    let mut has_spread = false;
    for id in hir[jsx].attrs.iter() {
        let attribute = &hir[id];
        if attribute.kind == PropKind::Spread {
            has_spread = true;
        } else if is_named_key(attribute) && attribute.value.is_some() {
            found = KeyAttribute {
                key: Some(id),
                is_after_spread: has_spread,
            };
        }
    }
    found
}

pub fn is_ignored_key(hir: &File<'_>, attribute: PropId) -> bool {
    let attribute = &hir[attribute];
    is_named_key(attribute) && attribute.value.is_none()
}

pub fn jsx_children<'a>(hir: &'a File<'_>, jsx: JsxId) -> impl Iterator<Item = ExprId> + 'a {
    let children = hir.ids(hir[jsx].children);
    children.filter(move |&child| !matches!(hir[child].kind, ExprKind::Missing))
}

pub fn has_static_children(hir: &File<'_>, jsx: JsxId) -> bool {
    let mut children = jsx_children(hir, jsx);
    match (children.next(), children.next()) {
        (Some(_), Some(_)) => true,
        (Some(only), None) => matches!(hir[only].kind, ExprKind::Spread(_)),
        (None, Some(_) | None) => false,
    }
}
