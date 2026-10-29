use crate as css;
use crate::css_rules::Location;
use crate::css_rules::layer::LayerName;
use crate::css_rules::supports::SupportsCondition;
use crate::media_query::MediaList;
use crate::{PrintErr, Printer};

use bun_alloc::Arena;

/// Layer slot of `ImportConditions.layer`.
#[derive(Default)]
pub struct Layer {
    /// PERF: null pointer optimizaiton, nullable
    pub v: Option<LayerName>,
}

impl Layer {
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
#[derive(Default)]
pub struct ImportConditions {
    /// An optional cascade layer name, or `None` for an anonymous layer.
    pub layer: Option<Layer>,

    /// An optional `supports()` condition.
    pub supports: Option<SupportsCondition>,

    /// A media query.
    pub media: MediaList,
}

impl ImportConditions {
    pub fn has_anonymous_layer(&self) -> bool {
        matches!(&self.layer, Some(l) if l.v.is_none())
    }

    pub(crate) fn deep_clone(&self, bump: &Arena) -> Self {
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
pub struct ImportRule {
    /// The url to import.
    // TODO: arena lifetime — `&'bump [u8]` once crate-wide thread lands.
    pub url: &'static [u8],

    /// The layer, `supports()` condition and media query.
    pub conditions: ImportConditions,

    /// This is default initialized to 2^32 - 1 when parsing.
    /// If we are bundling, this will be set to the index of the corresponding ImportRecord
    /// created for this import rule.
    pub import_record_idx: u32,

    /// The location of the rule in the source file.
    pub loc: Location,
}

impl Default for ImportRule {
    fn default() -> Self {
        Self {
            url: b"",
            conditions: ImportConditions::default(),
            import_record_idx: u32::MAX,
            loc: Location::dummy(),
        }
    }
}

impl ImportRule {
    pub fn from_url_and_import_record_idx(url: &'static [u8], import_record_idx: u32) -> Self {
        Self {
            url,
            import_record_idx,
            ..Default::default()
        }
    }

    pub fn has_conditions(&self) -> bool {
        self.conditions.layer.is_some()
            || self.conditions.supports.is_some()
            || !self.conditions.media.media_queries.is_empty()
    }

    pub(crate) fn deep_clone(&self, bump: &Arena) -> Self {
        // `url: &'static [u8]` is an arena-owned slice → identity copy.
        Self {
            url: self.url,
            conditions: self.conditions.deep_clone(bump),
            import_record_idx: self.import_record_idx,
            loc: self.loc,
        }
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        let dep: Option<css::dependencies::ImportDependency> = if dest.dependencies.is_some() {
            Some(css::dependencies::ImportDependency::new(
                dest.arena,
                self,
                dest.filename(),
            ))
        } else {
            None
        };

        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str("@import ")?;
        if let Some(d) = dep {
            // SAFETY: `placeholder` is arena-allocated by `css_modules::hash`
            // and outlives this print call.
            let placeholder = unsafe { crate::arena_str(d.placeholder) };
            dest.serialize_string(placeholder)?;

            if let Some(deps) = &mut dest.dependencies {
                deps.push(css::Dependency::Import(d));
            }
        } else {
            dest.serialize_string(self.url)?;
        }

        self.conditions.to_css(dest)?;
        dest.write_str(";")
    }
}
