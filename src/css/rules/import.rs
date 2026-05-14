use crate as css;
use crate::css_rules::Location;
use crate::css_rules::layer::LayerName;
use crate::css_rules::supports::SupportsCondition;
use crate::media_query::MediaList;
use crate::{PrintErr, Printer};

use bun_alloc::Arena;
use bun_ast::ImportRecord;
use bun_collections::VecExt;

/// Named replacement for the Zig anonymous `struct { v: ?LayerName }` used in
/// both `ImportConditions.layer` and `ImportRule.layer`. The two Zig anonymous
/// structs are layout-identical (the code `@ptrCast`s between the parents), so
/// we use a single Rust type for both.
#[repr(C)]
#[derive(Default)]
pub struct Layer {
    /// PERF: null pointer optimizaiton, nullable
    pub v: Option<LayerName>,
}

impl Layer {
    pub fn deep_clone(&self, bump: &Arena) -> Self {
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

/// TODO: change this to be field on ImportRule
/// The fields of this struct need to match the fields of ImportRule
/// because we cast between them
#[repr(C)]
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
    pub fn deep_clone(&self, bump: &Arena) -> Self {
        Self {
            layer: self.layer.as_ref().map(|l| l.deep_clone(bump)),
            supports: self.supports.as_ref().map(|s| s.deep_clone(bump)),
            media: super::dc::media_list(&self.media, bump),
        }
    }

    pub fn has_anonymous_layer(&self) -> bool {
        matches!(&self.layer, Some(l) if l.v.is_none())
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

    /// This code does the same thing as `deepClone` right now, but might change in the future so keeping this separate.
    ///
    /// So this code is used when we wrap a CSS file in import conditions in the final output chunk:
    /// ```css
    /// @layer foo {
    ///     /* css file contents */
    /// }
    /// ```
    ///
    /// However, the *prelude* of the condition /could/ contain a URL token:
    /// ```css
    /// @supports (background-image: url('example.png')) {
    ///     /* css file contents */
    /// }
    /// ```
    ///
    /// In this case, the URL token's import record actually belongs to the /parent/ of the current CSS file (the one who imported it).
    /// Therefore, we need to copy this import record from the parent into the import record list of this current CSS file.
    ///
    /// In actuality, the css parser doesn't create an import record for URL tokens in `@supports` because that's pointless in the context of hte
    /// @supports rule.
    ///
    /// Furthermore, a URL token is not valid in `@media` or `@layer` rules.
    ///
    /// But this could change in the future, so still keeping this function.
    ///
    // blocked_on: MediaList::clone_with_import_records (no impl yet on MediaList).

    pub fn clone_with_import_records(
        &self,
        arena: &Arena,
        import_records: &mut Vec<ImportRecord>,
    ) -> ImportConditions {
        ImportConditions {
            layer: self.layer.as_ref().map(|layer| Layer {
                v: layer
                    .v
                    .as_ref()
                    .map(|l| l.clone_with_import_records(arena, import_records)),
            }),
            supports: self
                .supports
                .as_ref()
                .map(|supp| supp.clone_with_import_records(arena, import_records)),
            media: self.media.clone_with_import_records(arena, import_records),
        }
    }

    pub fn layers_eql(lhs: &Self, rhs: &Self) -> bool {
        match (&lhs.layer, &rhs.layer) {
            (None, None) => true,
            (None, _) | (_, None) => false,
            (Some(a), Some(b)) => a.eql(b),
        }
    }

    // blocked_on: SupportsCondition::eql (gated in supports.rs on
    // generics::CssEql derive).

    pub fn supports_eql(lhs: &Self, rhs: &Self) -> bool {
        match (&lhs.supports, &rhs.supports) {
            (None, None) => true,
            (None, _) | (_, None) => false,
            (Some(a), Some(b)) => a.eql(b),
        }
    }
}

/// A [@import](https://drafts.csswg.org/css-cascade/#at-import) rule.
#[repr(C)]
pub struct ImportRule {
    /// The url to import.
    // TODO(port): arena lifetime — `&'bump [u8]` once crate-wide thread lands.
    pub url: &'static [u8],

    /// An optional cascade layer name, or `None` for an anonymous layer.
    pub layer: Option<Layer>,

    /// An optional `supports()` condition.
    pub supports: Option<SupportsCondition>,

    /// A media query.
    pub media: MediaList,

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
            layer: None,
            supports: None,
            media: MediaList::default(),
            import_record_idx: u32::MAX,
            loc: Location::dummy(),
        }
    }
}

impl ImportRule {
    pub fn from_url(url: &'static [u8]) -> Self {
        Self {
            url,
            ..Default::default()
        }
    }

    pub fn from_url_and_import_record_idx(url: &'static [u8], import_record_idx: u32) -> Self {
        Self {
            url,
            import_record_idx,
            ..Default::default()
        }
    }

    pub fn from_conditions_and_url(url: &'static [u8], conds: ImportConditions) -> Self {
        Self {
            url,
            layer: conds.layer,
            supports: conds.supports,
            media: conds.media,
            ..Default::default()
        }
    }

    pub fn conditions(&self) -> &ImportConditions {
        // SAFETY: ImportConditions is #[repr(C)] with fields {layer, supports, media}
        // laid out identically to the {layer, supports, media} field run of ImportRule
        // (also #[repr(C)]). The Zig code relies on this same layout pun via @ptrCast.
        // The pointer is derived from `self` (not `&self.layer`) so its provenance
        // covers all three fields — going through a field reference would narrow
        // provenance to just `layer` and make sibling-field reads UB under SB.
        // TODO(port): replace with an actual `conditions: ImportConditions` field on ImportRule
        let base = std::ptr::from_ref::<Self>(self).cast::<u8>();
        unsafe {
            &*base
                .add(core::mem::offset_of!(Self, layer))
                .cast::<ImportConditions>()
        }
    }

    pub fn conditions_mut(&mut self) -> &mut ImportConditions {
        // SAFETY: see `conditions()` above. Derived from `&mut self` (full-struct
        // provenance) via byte offset so the returned `&mut ImportConditions` may
        // legally write `supports` and `media`, not just `layer`.
        let base = std::ptr::from_mut::<Self>(self).cast::<u8>();
        unsafe {
            &mut *base
                .add(core::mem::offset_of!(Self, layer))
                .cast::<ImportConditions>()
        }
    }

    /// The `import_records` here is preserved from esbuild in the case that we do need it, it doesn't seem necessary now
    // blocked_on: MediaList::clone_with_import_records (no impl yet on MediaList).

    pub fn conditions_with_import_records(
        &self,
        arena: &Arena,
        import_records: &mut Vec<ImportRecord>,
    ) -> ImportConditions {
        ImportConditions {
            layer: self.layer.as_ref().map(|layer| Layer {
                v: layer
                    .v
                    .as_ref()
                    .map(|l| l.clone_with_import_records(arena, import_records)),
            }),
            supports: self
                .supports
                .as_ref()
                .map(|supp| supp.clone_with_import_records(arena, import_records)),
            media: self.media.clone_with_import_records(arena, import_records),
        }
    }

    pub fn has_conditions(&self) -> bool {
        self.layer.is_some() || self.supports.is_some() || !self.media.media_queries.is_empty()
    }

    pub fn deep_clone(&self, bump: &Arena) -> Self {
        // PORT NOTE: `css.implementDeepClone` field-walk. `url: &'static [u8]`
        // is an arena-owned slice → identity copy (generics.zig "const
        // strings" rule); `media` routes through `dc::media_list` until
        // `MediaList` gains an arena-aware `deep_clone`.
        Self {
            url: self.url,
            layer: self.layer.as_ref().map(|l| l.deep_clone(bump)),
            supports: self.supports.as_ref().map(|s| s.deep_clone(bump)),
            media: super::dc::media_list(&self.media, bump),
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
                dest.local_names,
                dest.symbols,
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
                // PERF(port): was `catch unreachable` (alloc cannot fail under arena)
                deps.push(css::Dependency::Import(d));
            }
        } else {
            dest.serialize_string(self.url)?;
        }

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
        dest.write_str(";")
    }
}

// Compile-time check that the layout pun in `conditions()`/`conditions_mut()`
// is valid: the {layer, supports, media} field run of ImportRule must match
// ImportConditions field-for-field.
const _: () = {
    let base = core::mem::offset_of!(ImportRule, layer);
    assert!(core::mem::offset_of!(ImportConditions, layer) == 0);
    assert!(
        core::mem::offset_of!(ImportRule, supports) - base
            == core::mem::offset_of!(ImportConditions, supports)
    );
    assert!(
        core::mem::offset_of!(ImportRule, media) - base
            == core::mem::offset_of!(ImportConditions, media)
    );
};

// silence unused-import warnings on the gated bodies' deps
#[allow(unused_imports)]
use {Arena as _Arena, ImportRecord as _ImportRecord};

// ported from: src/css/rules/import.zig
