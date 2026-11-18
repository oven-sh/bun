use core::cell::Cell;

use bun_alloc::AllocError;
use bun_engine_text::{Atom, StringRef, Text};

use crate::{Cx, Gc, JsResult, JsString};

const CACHE_SIZE: usize = 128;
const MAX_CACHED_LENGTH: usize = 40;

/// The address of an atom, which a cell holds at least until the cache is cleared, and that of what has become of it
/// once that has been asked for twice.
pub(super) struct CaseCache([Cell<(usize, usize)>; CACHE_SIZE]);

impl Default for CaseCache {
    fn default() -> CaseCache {
        CaseCache([const { Cell::new((0, 0)) }; CACHE_SIZE])
    }
}

impl CaseCache {
    pub(super) fn clear(&self) {
        self.0.iter().for_each(|entry| entry.set((0, 0)));
    }
}

impl JsString {
    /// `convert` returns `None` if nothing changes.
    #[inline(always)]
    pub fn converted(
        &self,
        cx: &Cx,
        convert: impl FnOnce(Text<'_>) -> Result<Option<StringRef>, AllocError>,
    ) -> JsResult<Gc<JsString>> {
        let converted = cx.or_out_of_memory(convert(self.view(cx)?.text()))?;
        Ok(converted.map_or_else(|| self.into(), |string| Self::new(cx, string)))
    }

    /// What becomes of a name is likely to be asked for again, and to be used as a name.
    #[inline(always)]
    fn in_case(
        &self,
        cx: &Cx,
        cache: &CaseCache,
        convert: fn(Text<'_>) -> Result<Option<StringRef>, AllocError>,
    ) -> JsResult<Gc<JsString>> {
        let atom = self.try_resolved();
        let Some(atom) = atom.filter(|it| it.is_atom() && it.len() <= MAX_CACHED_LENGTH) else {
            return self.converted(cx, convert);
        };
        let entry = &cache.0[atom.existing_hash() as usize % CACHE_SIZE];
        let (key, result) = entry.get();
        let is_repeated = key == atom.address();
        if is_repeated && result != 0 {
            // SAFETY: made, or found to be alive, since the last collection.
            return Ok(unsafe { Gc::from_address(result) });
        }
        let result = match cx.or_out_of_memory(convert(atom.text()))? {
            Some(string) if is_repeated => {
                let converted = cx.or_out_of_memory(Atom::try_from_string(&string))?;
                Self::new(cx, converted.into_string())
            }
            Some(string) => {
                entry.set((atom.address(), 0));
                return Ok(Self::new(cx, string));
            }
            None => self.into(),
        };
        entry.set((atom.address(), result.address()));
        Ok(result)
    }

    pub fn to_lower_case(&self, cx: &Cx) -> JsResult<Gc<JsString>> {
        let cache = &cx.services.text.strings.lower_case;
        self.in_case(cx, cache, bun_engine_unicode::to_lower_case)
    }

    pub fn to_upper_case(&self, cx: &Cx) -> JsResult<Gc<JsString>> {
        let cache = &cx.services.text.strings.upper_case;
        self.in_case(cx, cache, bun_engine_unicode::to_upper_case)
    }

    pub fn is_well_formed(&self, cx: &Cx) -> JsResult<bool> {
        Ok(self.is_latin1() || self.view(cx)?.text().is_well_formed())
    }

    pub fn to_well_formed(&self, cx: &Cx) -> JsResult<Gc<JsString>> {
        if self.is_latin1() {
            return Ok(self.into());
        }
        self.converted(cx, |text| text.to_well_formed())
    }
}
