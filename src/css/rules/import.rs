use crate::css_rules::layer::LayerName;
use crate::css_rules::supports::SupportsCondition;
use crate::css_rules::{Location, layer, media, supports};
use crate::media_query::MediaList;
use crate::{PrintErr, Printer};

use bun_alloc::Arena;

/// Layer slot of `ImportConditions.layer`.
pub struct Layer<'bump> {
    /// PERF: null pointer optimizaiton, nullable
    pub(crate) v: Option<LayerName<'bump>>,
}

impl Layer<'_> {
    pub(crate) fn deep_clone(&self, bump: &Arena) -> Self {
        Self {
            v: self.v.as_ref().map(|n| n.deep_clone(bump)),
        }
    }

    pub fn eql(&self, other: &Self) -> bool {
        match (&self.v, &other.v) {
            (None, None) => true,
            (None, _) | (_, None) => false,
            (Some(a), Some(b)) => a.eql(b),
        }
    }
}

/// The conditions of an [`ImportRule`].
pub struct ImportConditions<'bump> {
    /// An optional cascade layer name, or `None` for an anonymous layer.
    pub layer: Option<Layer<'bump>>,

    /// An optional `supports()` condition.
    pub supports: Option<SupportsCondition<'bump>>,

    /// A media query.
    pub media: MediaList<'bump>,
}

impl<'bump> ImportConditions<'bump> {
    pub fn has_anonymous_layer(&self) -> bool {
        matches!(&self.layer, Some(l) if l.v.is_none())
    }

    pub(crate) fn deep_clone(&self, bump: &'bump Arena) -> Self {
        Self {
            layer: self.layer.as_ref().map(|l| l.deep_clone(bump)),
            supports: self.supports.as_ref().map(|s| s.deep_clone(bump)),
            media: self.media.deep_clone(bump),
        }
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        if let Some(lyr) = &self.layer {
            dest.write_str(" layer")?;
            if let Some(l) = &lyr.v {
                dest.write_char(b'(')?;
                l.to_css(dest)?;
                dest.write_char(b')')?;
            }
        }

        if let Some(sup) = &self.supports {
            dest.write_str(" supports")?;
            if matches!(sup, SupportsCondition::Declaration(_)) {
                sup.to_css(dest)?;
            } else {
                dest.write_char(b'(')?;
                sup.to_css(dest)?;
                dest.write_char(b')')?;
            }
        }

        if !self.media.media_queries.is_empty() {
            dest.write_char(b' ')?;
            self.media.to_css(dest)?;
        }
        Ok(())
    }

    /// Prints `body` in the `@media` and `@supports` blocks that stand for these conditions.
    pub fn conditional_blocks_to_css<'p>(
        &self,
        dest: &mut Printer<'p>,
        body: impl FnOnce(&mut Printer<'p>) -> Result<(), PrintErr>,
    ) -> Result<(), PrintErr> {
        let supports = |d: &mut Printer<'p>| match &self.supports {
            Some(condition) => supports::block_to_css(condition, d, body),
            None => body(d),
        };
        if self.media.media_queries.is_empty() {
            supports(dest)
        } else {
            media::block_to_css(&self.media, dest, supports)
        }
    }

    /// Prints `body` in the `@media`, `@supports` and `@layer` blocks that stand for these conditions.
    pub fn blocks_to_css<'p>(
        &self,
        dest: &mut Printer<'p>,
        body: impl FnOnce(&mut Printer<'p>) -> Result<(), PrintErr>,
    ) -> Result<(), PrintErr> {
        self.conditional_blocks_to_css(dest, |d| match &self.layer {
            Some(layer) => layer::block_to_css(layer.v.as_ref(), d, body),
            None => body(d),
        })
    }

    pub fn layer_name(&self) -> Option<&LayerName<'bump>> {
        self.layer.as_ref()?.v.as_ref()
    }

    pub fn layers_eql(lhs: &Self, rhs: &Self) -> bool {
        match (&lhs.layer, &rhs.layer) {
            (None, None) => true,
            (None, _) | (_, None) => false,
            (Some(a), Some(b)) => a.eql(b),
        }
    }

    pub fn supports_eql(lhs: &Self, rhs: &Self) -> bool {
        match (&lhs.supports, &rhs.supports) {
            (None, None) => true,
            (None, _) | (_, None) => false,
            (Some(a), Some(b)) => a.eql(b),
        }
    }
}

/// A [@import](https://drafts.csswg.org/css-cascade/#at-import) rule.
pub struct ImportRule<'bump> {
    /// The url to import.
    pub(crate) url: &'bump [u8],

    /// The layer, `supports()` condition and media query.
    pub conditions: ImportConditions<'bump>,

    /// This is default initialized to 2^32 - 1 when parsing.
    /// If we are bundling, this will be set to the index of the corresponding ImportRecord
    /// created for this import rule.
    pub import_record_idx: u32,

    /// The location of the rule in the source file.
    pub(crate) loc: Location,
}

impl<'bump> ImportRule<'bump> {
    pub fn has_conditions(&self) -> bool {
        self.conditions.layer.is_some()
            || self.conditions.supports.is_some()
            || !self.conditions.media.media_queries.is_empty()
    }

    pub(crate) fn deep_clone(&self, bump: &'bump Arena) -> Self {
        Self {
            url: self.url,
            conditions: self.conditions.deep_clone(bump),
            import_record_idx: self.import_record_idx,
            loc: self.loc,
        }
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        rule_to_css(self.url, Some(&self.conditions), dest)
    }
}

pub fn rule_to_css(
    url: &[u8],
    conditions: Option<&ImportConditions>,
    dest: &mut Printer,
) -> Result<(), PrintErr> {
    dest.write_str("@import ")?;
    dest.serialize_string(url)?;

    if let Some(conditions) = conditions {
        conditions.to_css(dest)?;
    }
    dest.write_str(";")
}
