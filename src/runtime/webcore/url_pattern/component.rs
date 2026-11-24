//! <https://urlpattern.spec.whatwg.org/#component>

use bun_collections::smallvec::SmallVec;
use bun_core::{EncodedSlice, String, StringView};
use bun_jsc::bindgen::{self, JsHeap, JsRegExp};
use bun_jsc::regular_expression::Flags;

use super::PatternError;
use super::canonicalize::{Encoding, SPECIAL_SCHEMES, allocated};
use super::parser::{Options, Parts};

/// Empty for a group that is numbered.
pub(super) type GroupNames = SmallVec<[String; 16]>;

pub(super) struct Component<'a> {
    pub(super) pattern: String,
    pub(super) reg_exp: JsRegExp<'a>,
    pub(super) has_regexp_groups: bool,
}

impl<'a> Component<'a> {
    /// <https://urlpattern.spec.whatwg.org/#compile-a-component>. It appends to `group_names`.
    pub(super) fn compile(
        heap: &JsHeap<'a>,
        input: EncodedSlice<'_>,
        encoding: Encoding,
        options: Options,
        group_names: &mut GroupNames,
    ) -> Result<Self, PatternError> {
        let mut parts = Parts::new(input, options);
        parts.parse(encoding)?;
        let flags: &[Flags] = if options.ignore_case {
            &[Flags::UnicodeSets, Flags::IgnoreCase]
        } else {
            &[Flags::UnicodeSets]
        };
        let reg_exp = heap
            .create_reg_exp(&parts.to_regexp()?, flags)
            .ok_or(PatternError::Type(
                "Unable to create RegExp object regular expression from provided URLPattern string.",
            ))?;
        let pattern = parts.to_pattern_string()?;
        for name in parts.group_names() {
            group_names.push(allocated(String::clone(&StringView::from_encoded(name)))?);
        }
        Ok(Self {
            pattern,
            reg_exp,
            has_regexp_groups: parts.has_regexp_groups(),
        })
    }
}

/// <https://urlpattern.spec.whatwg.org/#protocol-component-matches-a-special-scheme>
pub(super) fn matches_special_scheme<'a>(
    heap: &JsHeap<'a>,
    protocol: JsRegExp<'a>,
) -> bindgen::Result<'a, bool> {
    for (scheme, _) in &SPECIAL_SCHEMES {
        if protocol.test(heap, EncodedSlice::latin1(scheme))? {
            return Ok(true);
        }
    }
    Ok(false)
}
