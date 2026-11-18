use bun_engine_regexp::{GroupNames, Template};
use bun_engine_text::Text;

use crate::{Cx, Gc, JsResult, JsString, RepeatedCall, StringSplicer, Value};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ReplaceMode {
    First,
    All,
}

impl ReplaceMode {
    #[inline(always)]
    fn limit(self) -> usize {
        match self {
            ReplaceMode::First => 1,
            ReplaceMode::All => usize::MAX,
        }
    }
}

impl JsString {
    /// `String.prototype.replace` and `replaceAll`, for a search that is a string.
    #[inline]
    pub fn replace(
        &self,
        cx: &mut Cx,
        mode: ReplaceMode,
        search: Gc<JsString>,
        replacement: Value,
    ) -> JsResult<Gc<JsString>> {
        if !replacement.is_string() && replacement.is_callable() {
            return self.replace_by_calling(cx, mode, search, replacement);
        }
        let template = replacement.to_string(cx)?;
        self.replace_by_template(cx, mode, &search, template)
    }

    /// `$$`, `$&`, `` $` `` and `$'` in `template` are expanded.
    #[inline]
    pub fn replace_by_template(
        &self,
        cx: &Cx,
        mode: ReplaceMode,
        search: &JsString,
        template: Gc<JsString>,
    ) -> JsResult<Gc<JsString>> {
        let view = template.view(cx)?;
        match (view.text().contains_unit(b'$'.into()), mode) {
            (false, ReplaceMode::First) => self.replace_first_literally(cx, search, template),
            (false, ReplaceMode::All) => self.replace_all_literally(cx, search, &template),
            (true, _) => self.replace_expanding(cx, mode, search, view.text()),
        }
    }

    pub fn replace_first_literally(
        &self,
        cx: &Cx,
        search: &JsString,
        replacement: Gc<JsString>,
    ) -> JsResult<Gc<JsString>> {
        let search = search.view(cx)?;
        let search = search.text();
        if search.len() == 1
            && self.is_worth_walking()
            && let Some(result) = self.replace_unit_in_fibers(cx, search.at(0), replacement)?
        {
            return Ok(result);
        }
        let view = self.view(cx)?;
        match view.text().find(search, 0) {
            Some(start) => view.replaced(cx, start..start + search.len(), replacement),
            None => Ok(self.into()),
        }
    }

    pub fn replace_all_literally(
        &self,
        cx: &Cx,
        search: &JsString,
        replacement: &JsString,
    ) -> JsResult<Gc<JsString>> {
        let (search, replacement) = (search.view(cx)?, replacement.view(cx)?);
        let (search, replacement) = (search.text(), replacement.text());
        self.converted(cx, |text| match (search.len(), replacement.len()) {
            (1, 1) => text.replace_unit(search.at(0), replacement.at(0)),
            _ => text.replace_all(search, replacement),
        })
    }

    #[inline(never)]
    fn replace_expanding(
        &self,
        cx: &Cx,
        mode: ReplaceMode,
        search: &JsString,
        template: Text<'_>,
    ) -> JsResult<Gc<JsString>> {
        let no_names = GroupNames::default();
        let (view, search) = (self.view(cx)?, search.view(cx)?);
        if mode == ReplaceMode::First {
            let Some(start) = view.text().find(search.text(), 0) else {
                return Ok(self.into());
            };
            let range = start..start + search.text().len();
            return view.replaced_with(cx, range.clone(), |out| {
                Template::expand(template, &no_names, out, view.text(), range, &[]);
            });
        }
        let mut parsed = Template::default();
        cx.or_out_of_memory(parsed.parse(template, 0, &no_names))?;
        let mut splicer = StringSplicer::new(&view);
        for start in view.text().matches(search.text()) {
            if cx.is_termination_requested() {
                return Err(cx.throw_termination());
            }
            if splicer.has_overflowed() {
                break;
            }
            let range = start..start + search.text().len();
            splicer.replace_with(range.clone(), |out| {
                parsed.append(out, view.text(), range, &[]);
            });
        }
        Ok(splicer.finish(cx)?.unwrap_or_else(|| self.into()))
    }

    #[inline(never)]
    fn replace_by_calling(
        &self,
        cx: &mut Cx,
        mode: ReplaceMode,
        search: Gc<JsString>,
        function: Value,
    ) -> JsResult<Gc<JsString>> {
        let (view, search_view) = (self.view(cx)?, search.view(cx)?);
        let (mut splicer, function) = (StringSplicer::new(&view), RepeatedCall::new(cx, function));
        for start in view.text().matches(search_view.text()).take(mode.limit()) {
            let arguments = [search.into(), start.into(), self.into()];
            let replacement = function.call(cx, Value::UNDEFINED, arguments)?;
            let range = start..start + search_view.text().len();
            splicer.replace(range, replacement.to_string(cx)?);
        }
        Ok(splicer.finish(cx)?.unwrap_or_else(|| self.into()))
    }
}
