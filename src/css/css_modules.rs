use core::fmt::Arguments;
use std::io::Write as _;

use bumpalo::collections::Vec as BumpVec;
use bun_alloc::Arena as Bump;
use bun_collections::ArrayHashMap;
use bun_wyhash::Wyhash11;

use crate as css;
use crate::PrintErr;
// TODO(port): narrow error set
pub use crate::Error;

pub struct CssModule<'a> {
    pub config: &'a Config,
    // TODO(port): LIFETIMES.tsv says Vec<String> but §Strings mandates bytes — fix TSV (Phase B: &'a [&'a [u8]] and drop .as_bytes() calls)
    pub sources: &'a Vec<String>,
    pub hashes: BumpVec<'a, &'a [u8]>,
    pub exports_by_source_index: BumpVec<'a, CssModuleExports<'a>>,
    pub references: &'a mut CssModuleReferences<'a>,
}

impl<'a> CssModule<'a> {
    pub fn new(
        bump: &'a Bump,
        config: &'a Config,
        sources: &'a Vec<String>,
        project_root: Option<&[u8]>,
        references: &'a mut CssModuleReferences<'a>,
    ) -> CssModule<'a> {
        // TODO: this is BAAAAAAAAAAD we are going to remove it
        let hashes = 'hashes: {
            let mut hashes = BumpVec::with_capacity_in(sources.len(), bump);
            for path in sources.iter() {
                let mut alloced = false;
                let source: &[u8] = 'source: {
                    // Make paths relative to project root so hashes are stable
                    if let Some(root) = project_root {
                        if bun_paths::Platform::auto().is_absolute(root) {
                            alloced = true;
                            break 'source bump.alloc_slice_copy(bun_paths::relative(root, path.as_bytes()));
                        }
                    }
                    break 'source path.as_bytes();
                };
                // PORT NOTE: Zig `defer if (alloced) allocator.free(source);` — arena-allocated, bulk-freed on bump.reset()
                let _ = alloced;
                // PERF(port): was appendAssumeCapacity — profile in Phase B
                hashes.push(hash(
                    bump,
                    format_args!("{}", bstr::BStr::new(source)),
                    matches!(config.pattern.segments.at(0), Segment::Hash),
                ));
            }
            break 'hashes hashes;
        };
        let exports_by_source_index = 'exports_by_source_index: {
            let mut exports_by_source_index = BumpVec::with_capacity_in(sources.len(), bump);
            // PERF(port): was appendNTimesAssumeCapacity — profile in Phase B
            for _ in 0..sources.len() {
                exports_by_source_index.push(CssModuleExports::default());
            }
            break 'exports_by_source_index exports_by_source_index;
        };
        CssModule {
            config,
            sources,
            references,
            hashes,
            exports_by_source_index,
        }
    }

    // PORT NOTE: `deinit` was a no-op (`// TODO: deinit`); Drop is implicit. No `impl Drop` needed.

    pub fn get_reference(&mut self, bump: &'a Bump, name: &'a [u8], source_index: u32) {
        // TODO(port): ArrayHashMap getOrPut API — assuming entry()-like; verify in Phase B
        let gop = self.exports_by_source_index[source_index as usize].get_or_put(bump, name);
        if gop.found_existing {
            gop.value.is_referenced = true;
        } else {
            *gop.value = CssModuleExport {
                name: self.config.pattern.write_to_string(
                    bump,
                    BumpVec::new_in(bump),
                    self.hashes[source_index as usize],
                    self.sources[source_index as usize].as_bytes(),
                    name,
                ),
                composes: BumpVec::new_in(bump),
                is_referenced: true,
            };
        }
    }

    pub fn reference_dashed(
        &mut self,
        dest: &mut css::Printer,
        name: &'a [u8],
        from: &Option<css::css_properties::css_modules::Specifier>,
        source_index: u32,
    ) -> Result<Option<&'a [u8]>, PrintErr> {
        let bump = dest.allocator;
        let (reference, key) = if let Some(specifier) = from {
            match specifier {
                css::css_properties::css_modules::Specifier::Global => return Ok(Some(&name[2..])),
                css::css_properties::css_modules::Specifier::ImportRecordIndex(import_record_index) => 'init: {
                    let import_record = dest.import_record(*import_record_index)?;
                    break 'init (
                        CssModuleReference::Dependency {
                            name: &name[2..],
                            specifier: import_record.path.text,
                        },
                        import_record.path.text,
                    );
                }
            }
        } else {
            // Local export. Mark as used.
            let gop = self.exports_by_source_index[source_index as usize].get_or_put(bump, name);
            if gop.found_existing {
                gop.value.is_referenced = true;
            } else {
                let mut res = BumpVec::new_in(bump);
                res.extend_from_slice(b"--");
                *gop.value = CssModuleExport {
                    name: self.config.pattern.write_to_string(
                        bump,
                        res,
                        self.hashes[source_index as usize],
                        self.sources[source_index as usize].as_bytes(),
                        &name[2..],
                    ),
                    composes: BumpVec::new_in(bump),
                    is_referenced: true,
                };
            }
            return Ok(None);
        };

        let the_hash = hash(
            bump,
            format_args!(
                "{}_{}_{}",
                bstr::BStr::new(self.hashes[source_index as usize]),
                bstr::BStr::new(name),
                bstr::BStr::new(key)
            ),
            false,
        );

        // PORT NOTE: std.fmt.allocPrint → write into bump Vec (never `format!`, returns String)
        let mut k = BumpVec::new_in(bump);
        write!(&mut k, "--{}", bstr::BStr::new(the_hash)).expect("unreachable");
        self.references.put(bump, k.into_bump_slice(), reference);

        Ok(Some(the_hash))
    }

    pub fn handle_composes(
        &mut self,
        _dest: &mut css::Printer,
        selectors: &css::selector::parser::SelectorList,
        _composes: &css::css_properties::css_modules::Composes,
        _source_index: u32,
    ) -> css::Maybe<(), css::PrinterErrorKind> {
        // let bump = dest.allocator;
        for sel in selectors.v.slice() {
            if sel.len() == 1 && matches!(sel.components[0], css::selector::parser::Component::Class(_)) {
                continue;
            }

            // The composes property can only be used within a simple class selector.
            return css::Maybe::Err(css::PrinterErrorKind::InvalidComposesSelector);
        }

        css::Maybe::success()
    }

    pub fn add_dashed(&mut self, bump: &'a Bump, local: &'a [u8], source_index: u32) {
        let gop = self.exports_by_source_index[source_index as usize].get_or_put(bump, local);
        if !gop.found_existing {
            *gop.value = CssModuleExport {
                // todo_stuff.depth
                name: self.config.pattern.write_to_string_with_prefix(
                    bump,
                    b"--",
                    self.hashes[source_index as usize],
                    self.sources[source_index as usize].as_bytes(),
                    &local[2..],
                ),
                composes: BumpVec::new_in(bump),
                is_referenced: false,
            };
        }
    }

    pub fn add_local(&mut self, bump: &'a Bump, exported: &'a [u8], local: &'a [u8], source_index: u32) {
        let gop = self.exports_by_source_index[source_index as usize].get_or_put(bump, exported);
        if !gop.found_existing {
            *gop.value = CssModuleExport {
                // todo_stuff.depth
                name: self.config.pattern.write_to_string(
                    bump,
                    BumpVec::new_in(bump),
                    self.hashes[source_index as usize],
                    self.sources[source_index as usize].as_bytes(),
                    local,
                ),
                composes: BumpVec::new_in(bump),
                is_referenced: false,
            };
        }
    }
}

/// Configuration for CSS modules.
pub struct Config {
    /// The name pattern to use when renaming class names and other identifiers.
    /// Default is `[hash]_[local]`.
    pub pattern: Pattern,

    /// Whether to rename dashed identifiers, e.g. custom properties.
    pub dashed_idents: bool,

    /// Whether to scope animation names.
    /// Default is `true`.
    pub animation: bool,

    /// Whether to scope grid names.
    /// Default is `true`.
    pub grid: bool,

    /// Whether to scope custom identifiers
    /// Default is `true`.
    pub custom_idents: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            pattern: Pattern::default(),
            dashed_idents: false,
            animation: true,
            grid: true,
            custom_idents: true,
        }
    }
}

/// A CSS modules class name pattern.
pub struct Pattern {
    /// The list of segments in the pattern.
    pub segments: css::SmallList<Segment, 3>,
}

impl Default for Pattern {
    fn default() -> Self {
        Self {
            // TODO(port): SmallList::init_inlined API — verify in Phase B
            segments: css::SmallList::init_inlined(&[Segment::Local, Segment::Literal(b"_"), Segment::Hash]),
        }
    }
}

impl Pattern {
    /// Write the substituted pattern to a destination.
    pub fn write(
        &self,
        hash_: &[u8],
        path: &[u8],
        local: &[u8],
        mut writefn: impl FnMut(&[u8], /* replace_dots: */ bool),
    ) {
        for segment in self.segments.slice() {
            match segment {
                Segment::Literal(s) => {
                    writefn(s, false);
                }
                Segment::Name => {
                    // TODO(port): std.fs.path.stem — bun_paths::stem(&[u8]) (do NOT use std::path, operates on OsStr)
                    let stem = bun_paths::stem(path);
                    if bun_str::strings::index_of(stem, b".").is_some() {
                        writefn(stem, true);
                    } else {
                        writefn(stem, false);
                    }
                }
                Segment::Local => {
                    writefn(local, false);
                }
                Segment::Hash => {
                    writefn(hash_, false);
                }
            }
        }
    }

    pub fn write_to_string_with_prefix<'a>(
        &self,
        bump: &'a Bump,
        prefix: &'static [u8],
        hash_: &[u8],
        path: &[u8],
        local: &[u8],
    ) -> &'a [u8] {
        let mut res: BumpVec<'a, u8> = BumpVec::new_in(bump);
        self.write(hash_, path, local, |slice: &[u8], replace_dots: bool| {
            res.extend_from_slice(prefix);
            if replace_dots {
                let start = res.len();
                res.extend_from_slice(slice);
                let end = res.len();
                for c in &mut res[start..end] {
                    if *c == b'.' {
                        *c = b'-';
                    }
                }
                return;
            }
            res.extend_from_slice(slice);
        });
        res.into_bump_slice()
    }

    pub fn write_to_string<'a>(
        &self,
        #[allow(unused)] bump: &'a Bump,
        res_: BumpVec<'a, u8>,
        hash_: &[u8],
        path: &[u8],
        local: &[u8],
    ) -> &'a [u8] {
        let mut res = res_;
        self.write(hash_, path, local, |slice: &[u8], replace_dots: bool| {
            if replace_dots {
                let start = res.len();
                res.extend_from_slice(slice);
                let end = res.len();
                for c in &mut res[start..end] {
                    if *c == b'.' {
                        *c = b'-';
                    }
                }
                return;
            }
            res.extend_from_slice(slice);
        });

        res.into_bump_slice()
    }
}

/// A segment in a CSS modules class name pattern.
///
/// See [Pattern](Pattern).
pub enum Segment {
    /// A literal string segment.
    Literal(&'static [u8]),

    /// The base file name.
    Name,

    /// The original class name.
    Local,

    /// A hash of the file name.
    Hash,
}

/// A map of exported names to values.
// TODO(port): std.StringArrayHashMapUnmanaged → bun_collections::ArrayHashMap; key is arena &[u8]
pub type CssModuleExports<'a> = ArrayHashMap<&'a [u8], CssModuleExport<'a>>;

/// A map of placeholders to references.
pub type CssModuleReferences<'a> = ArrayHashMap<&'a [u8], CssModuleReference<'a>>;

/// An exported value from a CSS module.
pub struct CssModuleExport<'a> {
    /// The local (compiled) name for this export.
    pub name: &'a [u8],
    /// Other names that are composed by this export.
    pub composes: BumpVec<'a, CssModuleReference<'a>>,
    /// Whether the export is referenced in this file.
    pub is_referenced: bool,
}

/// A referenced name within a CSS module, e.g. via the `composes` property.
///
/// See [CssModuleExport](CssModuleExport).
pub enum CssModuleReference<'a> {
    /// A local reference.
    Local {
        /// The local (compiled) name for the reference.
        name: &'a [u8],
    },
    /// A global reference.
    Global {
        /// The referenced global name.
        name: &'a [u8],
    },
    /// A reference to an export in a different file.
    Dependency {
        /// The name to reference within the dependency.
        name: &'a [u8],
        /// The dependency specifier for the referenced file.
        ///
        /// import record idx
        specifier: &'a [u8],
    },
}

impl<'a> CssModuleReference<'a> {
    pub fn eql(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Local { name: a }, Self::Local { name: b }) => a == b,
            (Self::Global { name: a }, Self::Global { name: b }) => a == b,
            // .dependency => |v| bun.strings.eql(v.name, other.dependency.name) and bun.strings.eql(v.specifier, other.dependency.specifier),
            (
                Self::Dependency { name: an, specifier: asp },
                Self::Dependency { name: bn, specifier: bsp },
            ) => an == bn && asp == bsp,
            _ => false,
        }
    }
}

// TODO: replace with bun's hash
pub fn hash<'a>(bump: &'a Bump, args: Arguments<'_>, at_start: bool) -> &'a [u8] {
    // PERF(port): was stack-fallback alloc (StackFallbackAllocator 128B) — profile in Phase B
    let mut hasher = Wyhash11::init(0);
    // PORT NOTE: std.fmt.count + allocPrint collapsed; write into bump Vec then hash
    let mut fmt_str: BumpVec<'a, u8> = BumpVec::new_in(bump);
    write!(&mut fmt_str, "{}", args).expect("unreachable");
    hasher.update(&fmt_str);

    let h: u32 = hasher.final_() as u32; // @truncate
    let h_bytes: [u8; 4] = h.to_le_bytes();

    let encode_len = bun_base64::simdutf_encode_len_url_safe(h_bytes.len());

    // PORT NOTE: Zig reused fmt_str buffer when encode_len > 128 - at_start; arena makes the
    // distinction moot (both arms allocate from bump). Always alloc fresh slice here.
    // PERF(port): was buffer reuse for large encode_len — profile in Phase B
    let slice_to_write: &mut [u8] =
        bump.alloc_slice_fill_default(encode_len + usize::from(at_start));

    let base64_encoded_hash_len =
        bun_base64::simdutf_encode_url_safe(slice_to_write, &h_bytes);

    let base64_encoded_hash = &slice_to_write[0..base64_encoded_hash_len];

    if at_start
        && !base64_encoded_hash.is_empty()
        && base64_encoded_hash[0] >= b'0'
        && base64_encoded_hash[0] <= b'9'
    {
        // std.mem.copyBackwards: overlapping copy, dest > src → copy_within
        slice_to_write.copy_within(0..base64_encoded_hash_len, 1);
        slice_to_write[0] = b'_';
        return &slice_to_write[0..base64_encoded_hash_len + 1];
    }

    &slice_to_write[0..base64_encoded_hash_len]
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/css_modules.zig (430 lines)
//   confidence: medium
//   todos:      6
//   notes:      arena crate — threaded 'a bump lifetime through all structs; ArrayHashMap get_or_put/put API and SmallList::init_inlined need Phase B verification; LIFETIMES.tsv `Vec<String>` for sources kept verbatim (TSV wins per §Type map) but conflicts with §Strings bytes rule — fix TSV in Phase B
// ──────────────────────────────────────────────────────────────────────────
