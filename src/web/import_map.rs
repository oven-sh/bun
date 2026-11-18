//! https://html.spec.whatwg.org/#import-maps

use crate::Bytes;
use crate::url::Url;

/// `None` blocks the specifier.
type SpecifierMap = Vec<(Bytes, Option<Url>)>;

/// The members of the JSON. `None` is what is not a string.
pub type Given = Vec<(Vec<u8>, Option<Vec<u8>>)>;

struct Resolved {
    base: Bytes,
    specifier: Bytes,
    may_be_prefixed: bool,
}

#[derive(Default)]
pub struct ImportMap {
    imports: SpecifierMap,
    scopes: Vec<(Bytes, SpecifierMap)>,
    integrity: Vec<(Bytes, Bytes)>,
    resolved: Vec<Resolved>,
}

pub enum Unresolved {
    Blocked,
    Bare,
}

/// https://html.spec.whatwg.org/#resolving-a-url-like-module-specifier
fn url_like(specifier: &[u8], base: &Url) -> Option<Url> {
    if [&b"/"[..], b"./", b"../"]
        .iter()
        .any(|it| specifier.starts_with(it))
    {
        base.join(specifier)
    } else {
        Url::parse(specifier)
    }
}

fn covers(key: &[u8], name: &[u8], may_be_prefix: bool) -> bool {
    key == name || (may_be_prefix && key.ends_with(b"/") && name.starts_with(key))
}

fn normalize(given: &Given, base: &Url) -> SpecifierMap {
    let mut map = SpecifierMap::new();
    for (key, address) in given.iter().filter(|it| !it.0.is_empty()) {
        let address = address
            .as_ref()
            .and_then(|it| url_like(it, base))
            .filter(|it| !key.ends_with(b"/") || it.href().ends_with(b"/"));
        let key = url_like(key, base).map_or_else(|| Bytes::from(&**key), |it| it.href().into());
        map.retain(|it| it.0 != key);
        map.push((key, address));
    }
    map
}

/// https://html.spec.whatwg.org/#resolving-an-imports-match
fn look_up(
    map: &SpecifierMap,
    name: &[u8],
    may_be_prefixed: bool,
) -> Option<Result<Url, Unresolved>> {
    let (key, address) = map.iter().find(|it| covers(&it.0, name, may_be_prefixed))?;
    let found = address
        .as_ref()
        .and_then(|address| match &name[key.len()..] {
            b"" => Some(address.clone()),
            rest => address
                .join(rest)
                .filter(|it| it.href().starts_with(address.href())),
        });
    Some(found.ok_or(Unresolved::Blocked))
}

impl ImportMap {
    /// https://html.spec.whatwg.org/#resolve-a-module-specifier
    pub fn resolve(&mut self, specifier: &[u8], base: &Url) -> Result<Url, Unresolved> {
        let url = url_like(specifier, base);
        let name = url.as_ref().map_or(specifier, Url::href);
        let may_be_prefixed = url
            .as_ref()
            .is_none_or(|it| it.is_http_or_ws() || matches!(it.scheme(), b"file" | b"ftp"));
        let in_scope = self
            .scopes
            .iter()
            .filter(|it| covers(&it.0, base.href(), true));
        let found = in_scope
            .map(|it| &it.1)
            .chain([&self.imports])
            .find_map(|it| look_up(it, name, may_be_prefixed))
            .unwrap_or_else(|| url.clone().ok_or(Unresolved::Bare))?;
        self.resolved.push(Resolved {
            base: base.href().into(),
            specifier: name.into(),
            may_be_prefixed,
        });
        Ok(found)
    }

    /// What has been resolved, and what has a rule, stays as it is.
    fn merge(
        resolved: &[Resolved],
        old: &mut SpecifierMap,
        added: SpecifierMap,
        scope: Option<&[u8]>,
    ) {
        for rule in added {
            let is_settled = old.iter().any(|it| it.0 == rule.0)
                || resolved.iter().any(|it| {
                    scope.is_none_or(|scope| covers(scope, &it.base, true))
                        && covers(&rule.0, &it.specifier, it.may_be_prefixed)
                });
            if !is_settled {
                old.push(rule);
            }
        }
        bun_collections::index_sort::sort_slice_by(old, |a, b| b.0.cmp(&a.0));
    }

    /// https://html.spec.whatwg.org/#merge-existing-and-new-import-maps
    pub fn add(
        &mut self,
        imports: &Given,
        scopes: &[(Vec<u8>, Given)],
        integrity: &Given,
        base: &Url,
    ) {
        for (prefix, given) in scopes {
            let Some(prefix) = base.join(prefix) else {
                continue;
            };
            let at = self.scopes.iter().position(|it| *it.0 == *prefix.href());
            let at = at.unwrap_or_else(|| {
                self.scopes
                    .push((prefix.href().into(), SpecifierMap::new()));
                self.scopes.len() - 1
            });
            let added = normalize(given, base);
            ImportMap::merge(
                &self.resolved,
                &mut self.scopes[at].1,
                added,
                Some(prefix.href()),
            );
        }
        bun_collections::index_sort::sort_slice_by(&mut self.scopes, |a, b| b.0.cmp(&a.0));
        for (key, hash) in integrity {
            if let (Some(url), Some(hash)) = (url_like(key, base), hash)
                && self.integrity_of(&url).is_none()
            {
                self.integrity.push((url.href().into(), (**hash).into()));
            }
        }
        ImportMap::merge(
            &self.resolved,
            &mut self.imports,
            normalize(imports, base),
            None,
        );
    }

    pub fn integrity_of(&self, url: &Url) -> Option<&Bytes> {
        Some(&self.integrity.iter().find(|it| *it.0 == *url.href())?.1)
    }
}
