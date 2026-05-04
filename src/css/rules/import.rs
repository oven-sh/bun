use crate::css_parser as css;
use css::css_rules::layer::LayerName;
use css::css_rules::supports::SupportsCondition;
use css::css_rules::Location;
use css::{dependencies, Dependency, MediaList, PrintErr, Printer};

use bun_alloc::Arena; // bumpalo::Bump re-export
use bun_collections::BabyList;
use bun_options_types::ImportRecord;

/// Named replacement for the Zig anonymous `struct { v: ?LayerName }` used in
/// both `ImportConditions.layer` and `ImportRule.layer`. The two Zig anonymous
/// structs are layout-identical (the code `@ptrCast`s between the parents), so
/// we use a single Rust type for both.
#[repr(C)]
#[derive(Clone)]
pub struct ImportLayer {
    /// PERF: null pointer optimizaiton, nullable
    pub v: Option<LayerName>,
}

impl ImportLayer {
    pub fn eql(&self, other: &Self) -> bool {
        match (&self.v, &other.v) {
            (None, None) => true,
            (None, _) | (_, None) => false,
            (Some(a), Some(b)) => a.eql(b),
        }
    }

    pub fn deep_clone(&self, allocator: &Arena) -> Self {
        // TODO(port): css.implementDeepClone is comptime-reflection field-walk; replace with derive
        css::implement_deep_clone(self, allocator)
    }
}

/// TODO: change this to be field on ImportRule
/// The fields of this struct need to match the fields of ImportRule
/// because we cast between them
#[repr(C)]
pub struct ImportConditions {
    /// An optional cascade layer name, or `None` for an anonymous layer.
    pub layer: Option<ImportLayer>,

    /// An optional `supports()` condition.
    pub supports: Option<SupportsCondition>,

    /// A media query.
    pub media: MediaList,
}

impl Default for ImportConditions {
    fn default() -> Self {
        Self {
            layer: None,
            supports: None,
            media: MediaList::default(),
        }
    }
}

impl ImportConditions {
    pub fn hash<H: core::hash::Hasher>(&self, hasher: &mut H) {
        // TODO(port): css.implementHash is comptime-reflection field-walk; replace with #[derive(Hash)]
        css::implement_hash(self, hasher);
    }

    pub fn has_anonymous_layer(&self) -> bool {
        matches!(&self.layer, Some(l) if l.v.is_none())
    }

    pub fn deep_clone(&self, allocator: &Arena) -> ImportConditions {
        ImportConditions {
            layer: match &self.layer {
                Some(l) => Some(ImportLayer {
                    v: l.v.as_ref().map(|layer| layer.deep_clone(allocator)),
                }),
                None => None,
            },
            supports: self.supports.as_ref().map(|s| s.deep_clone(allocator)),
            media: self.media.deep_clone(allocator),
        }
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        if let Some(lyr) = &self.layer {
            dest.write_str(" layer")?;
            if let Some(l) = &lyr.v {
                dest.write_char('(')?;
                l.to_css(dest)?;
                dest.write_char(')')?;
            }
        }

        if let Some(sup) = &self.supports {
            dest.write_str(" supports")?;
            if matches!(sup, SupportsCondition::Declaration { .. }) {
                sup.to_css(dest)?;
            } else {
                dest.write_char('(')?;
                sup.to_css(dest)?;
                dest.write_char(')')?;
            }
        }

        if !self.media.media_queries.is_empty() {
            dest.write_char(' ')?;
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
    pub fn clone_with_import_records(
        &self,
        allocator: &Arena,
        import_records: &mut BabyList<ImportRecord>,
    ) -> ImportConditions {
        ImportConditions {
            layer: match &self.layer {
                Some(layer) => Some(ImportLayer {
                    v: layer
                        .v
                        .as_ref()
                        .map(|l| l.clone_with_import_records(allocator, import_records)),
                }),
                None => None,
            },
            supports: self
                .supports
                .as_ref()
                .map(|supp| supp.clone_with_import_records(allocator, import_records)),
            media: self.media.clone_with_import_records(allocator, import_records),
        }
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
#[repr(C)]
pub struct ImportRule {
    /// The url to import.
    // TODO(port): arena-owned slice; consider `&'bump [u8]` once crate-wide lifetime is threaded
    pub url: *const [u8],

    /// An optional cascade layer name, or `None` for an anonymous layer.
    pub layer: Option<ImportLayer>,

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

impl ImportRule {
    pub fn from_url(url: &[u8]) -> Self {
        Self {
            url: url as *const [u8],
            layer: None,
            supports: None,
            media: MediaList { media_queries: Default::default() },
            import_record_idx: u32::MAX,
            loc: Location::dummy(),
        }
    }

    pub fn from_url_and_import_record_idx(url: &[u8], import_record_idx: u32) -> Self {
        Self {
            url: url as *const [u8],
            layer: None,
            supports: None,
            media: MediaList { media_queries: Default::default() },
            import_record_idx,
            loc: Location::dummy(),
        }
    }

    pub fn from_conditions_and_url(url: &[u8], conds: ImportConditions) -> Self {
        Self {
            url: url as *const [u8],
            layer: match conds.layer {
                Some(layer) => Some(ImportLayer { v: layer.v }),
                None => None,
            },
            supports: conds.supports,
            media: conds.media,
            import_record_idx: u32::MAX,
            loc: Location::dummy(),
        }
    }

    pub fn conditions(&self) -> &ImportConditions {
        // SAFETY: ImportConditions is #[repr(C)] with fields {layer, supports, media}
        // laid out identically to the {layer, supports, media} field run of ImportRule
        // (also #[repr(C)]). The Zig code relies on this same layout pun via @ptrCast.
        // TODO(port): replace with an actual `conditions: ImportConditions` field on ImportRule
        unsafe { &*(&self.layer as *const Option<ImportLayer> as *const ImportConditions) }
    }

    pub fn conditions_mut(&mut self) -> &mut ImportConditions {
        // SAFETY: see `conditions()` above.
        unsafe { &mut *(&mut self.layer as *mut Option<ImportLayer> as *mut ImportConditions) }
    }

    /// The `import_records` here is preserved from esbuild in the case that we do need it, it doesn't seem necessary now
    pub fn conditions_with_import_records(
        &self,
        allocator: &Arena,
        import_records: &mut BabyList<ImportRecord>,
    ) -> ImportConditions {
        ImportConditions {
            layer: match &self.layer {
                Some(layer) => Some(ImportLayer {
                    v: layer
                        .v
                        .as_ref()
                        .map(|l| l.clone_with_import_records(allocator, import_records)),
                }),
                None => None,
            },
            supports: self
                .supports
                .as_ref()
                .map(|supp| supp.clone_with_import_records(allocator, import_records)),
            media: self.media.clone_with_import_records(allocator, import_records),
        }
    }

    pub fn has_conditions(&self) -> bool {
        self.layer.is_some() || self.supports.is_some() || !self.media.media_queries.is_empty()
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        let dep = if dest.dependencies.is_some() {
            Some(dependencies::ImportDependency::new(
                dest.allocator,
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
            if css::serializer::serialize_string(&d.placeholder, dest).is_err() {
                return dest.add_fmt_error();
            }

            if let Some(deps) = &mut dest.dependencies {
                // PERF(port): was `catch unreachable` (alloc cannot fail under arena)
                deps.push(Dependency::Import(d));
            }
        } else {
            // SAFETY: `url` is an arena-owned slice valid for the lifetime of `self`.
            let url = unsafe { &*self.url };
            if css::serializer::serialize_string(url, dest).is_err() {
                return dest.add_fmt_error();
            }
        }

        if let Some(lyr) = &self.layer {
            dest.write_str(" layer")?;
            if let Some(l) = &lyr.v {
                dest.write_char('(')?;
                l.to_css(dest)?;
                dest.write_char(')')?;
            }
        }

        if let Some(sup) = &self.supports {
            dest.write_str(" supports")?;
            if matches!(sup, SupportsCondition::Declaration { .. }) {
                sup.to_css(dest)?;
            } else {
                dest.write_char('(')?;
                sup.to_css(dest)?;
                dest.write_char(')')?;
            }
        }

        if !self.media.media_queries.is_empty() {
            dest.write_char(' ')?;
            self.media.to_css(dest)?;
        }
        dest.write_str(";")?;
        Ok(())
    }

    pub fn deep_clone(&self, allocator: &Arena) -> Self {
        // TODO(port): css.implementDeepClone is comptime-reflection field-walk; replace with derive
        css::implement_deep_clone(self, allocator)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/import.zig (268 lines)
//   confidence: medium
//   todos:      4
//   notes:      layout-pun conditions()/conditions_mut() needs #[repr(C)] verified; url field is raw arena ptr pending crate-wide 'bump lifetime; implement_hash/implement_deep_clone are reflection helpers needing trait/derive in Phase B
// ──────────────────────────────────────────────────────────────────────────
