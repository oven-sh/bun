//! The replacements of UTS #35, Annex C, with the `alias` tables of CLDR.

use core::ffi::CStr;
use std::sync::OnceLock;

use bun_icu::Buffer;
use bun_icu::resource_bundle::ResourceBundle;

use super::language_id::{LanguageId, Variants, join};
use super::subtag::{Subtag, Subtags, is_region};
use crate::Result;

/// More than any chain of rules has.
const MAX_REPLACEMENTS: usize = 32;

struct Table(Option<ResourceBundle>);

impl Table {
    fn replacement(&self, key: impl IntoIterator<Item = Subtag>) -> Option<Buffer<u8>> {
        let rule = self.0.as_ref()?.by_key(&join(key).ok()?).ok()?;
        let replacement = rule.string_by_key(c"replacement").ok()?;
        (replacement.iter())
            .map(|&unit| u8::try_from(unit).ok())
            .collect()
    }

    fn first_replacement(&self, key: Subtag) -> Option<Subtag> {
        Subtag::new(Subtags::new(&self.replacement([key])?).next()?)
    }
}

struct Aliases {
    language: Table,
    script: Table,
    region: Table,
    variant: Table,
    subdivision: Table,
}

fn aliases() -> &'static Aliases {
    static ALIASES: OnceLock<Aliases> = OnceLock::new();
    ALIASES.get_or_init(|| {
        let tables = ResourceBundle::open_direct(c"metadata").and_then(|it| it.by_key(c"alias"));
        let table = |name: &CStr| Table(tables.as_ref().ok().and_then(|it| it.by_key(name).ok()));
        Aliases {
            language: table(c"language"),
            script: table(c"script"),
            region: table(c"territory"),
            variant: table(c"variant"),
            subdivision: table(c"subdivision"),
        }
    })
}

pub(crate) fn replace_aliases(id: &mut LanguageId) -> Result<()> {
    let aliases = aliases();
    for _ in 0..MAX_REPLACEMENTS {
        if !aliases.apply_first_rule(id)? {
            break;
        }
    }
    Ok(())
}

/// For the value of `rg` or `sd`.
pub(crate) fn subdivision_replacement(value: &[u8]) -> Option<Subtag> {
    let replacement = (aliases().subdivision).first_replacement(Subtag::new(value)?)?;
    match *replacement.to_lowercase().as_bytes() {
        [first, second] => Subtag::new(&[first, second, b'z', b'z', b'z', b'z']),
        _ => Some(replacement),
    }
}

impl Aliases {
    /// Rules that match more subtags go first, then those for the language, the script, the region and the variants.
    fn apply_first_rule(&self, id: &mut LanguageId) -> Result<bool> {
        if let Some(region) = id.region
            && let Some(replacement) = self.language_replacement([id.language, region])?
        {
            id.region = None;
            return merge(id, &replacement);
        }
        if id.language != Subtag::UND {
            for &variant in id.variants.as_slice() {
                if let Some(replacement) = self.language_replacement([id.language, variant])? {
                    id.variants.remove(variant);
                    return merge(id, &replacement);
                }
            }
        }
        // The only rule for two variants.
        if let (Some(hepburn), Some(heploc)) = (Subtag::new(b"hepburn"), Subtag::new(b"heploc"))
            && id.variants.contains(hepburn)
            && id.variants.contains(heploc)
        {
            id.variants.remove(hepburn);
            return Ok(true);
        }
        if let Some(replacement) = self.language_replacement([id.language])? {
            return merge(id, &replacement);
        }
        if let Some(script) = id.script.and_then(|it| self.script.first_replacement(it)) {
            id.script = Some(script);
            return Ok(true);
        }
        if let Some(regions) = id.region.and_then(|it| self.region.replacement([it])) {
            id.region = choose_region(id, &regions);
            return Ok(true);
        }
        for &variant in id.variants.as_slice() {
            if let Some(replacement) = self.language_replacement([Subtag::UND, variant])? {
                id.variants.remove(variant);
                return merge(id, &replacement);
            }
            if let Some(replacement) = self.variant.first_replacement(variant) {
                id.variants.remove(variant);
                id.variants.insert(replacement)?;
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn language_replacement<const N: usize>(&self, key: [Subtag; N]) -> Result<Option<LanguageId>> {
        match self.language.replacement(key) {
            Some(replacement) => LanguageId::parse_all(&replacement),
            None => Ok(None),
        }
    }
}

/// `id` has lost the region or the variant that the rule matched.
fn merge(id: &mut LanguageId, replacement: &LanguageId) -> Result<bool> {
    if replacement.language != Subtag::UND {
        id.language = replacement.language;
    }
    id.script = id.script.or(replacement.script);
    id.region = id.region.or(replacement.region);
    for &variant in replacement.variants.as_slice() {
        id.variants.insert(variant)?;
    }
    Ok(true)
}

/// The likely region of the language and the script if it is in the list, or else the first.
fn choose_region(id: &LanguageId, list: &[u8]) -> Option<Subtag> {
    let mut regions = (Subtags::new(list).filter(|it| is_region(it))).filter_map(Subtag::new);
    let first = regions.next();
    let mut others = regions.peekable();
    if others.peek().is_none() {
        return first;
    }
    let mut likely = LanguageId {
        region: None,
        variants: Variants::default(),
        ..*id
    };
    likely.maximize();
    others.find(|&it| Some(it) == likely.region).or(first)
}
