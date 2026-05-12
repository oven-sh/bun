use crate::lockfile::package::PackageColumns as _;
use std::io::Write as _;

use bun_ast::{Loc, Log};
use bun_core::strings;
use bun_core::{Global, Output};
use bun_js_parser as js_ast;
use bun_semver::{SlicedString, String as SemverString, string::Builder as StringBuilder};

use bun_install::dependency::{self, DependencyExt as _};
use bun_install::{
    Dependency, INVALID_PACKAGE_ID, Lockfile, PackageID, PackageManager, PackageNameHash,
};
// `lockfile.packages.items_name()` is provided by an extension trait on
// `MultiArrayList<Package>` (Zig: `lockfile.packages.items(.name)`).
pub struct UpdateRequest {
    // TODO(port): lifetime — Zig leaks these (no deinit); using &'static for now
    pub name: &'static [u8],
    pub name_hash: PackageNameHash,
    pub version: dependency::Version,
    /// Backing buffer for `version.literal` (and friends) — either a leaked
    /// CLI positional (truly process-lifetime) or the active lockfile's
    /// `buffers.string_bytes`. Stored as a raw fat pointer because the
    /// lockfile buffer's lifetime cannot be expressed as `'static` without UB
    /// lifetime extension (PORTING.md §Forbidden patterns), and threading a
    /// real `<'a>` through every `&mut [UpdateRequest]` in the install
    /// pipeline is the Phase-B reshape. ARENA-class field per the PORTING.md
    /// type map: `[]const u8` struct-field, never freed, points into a buffer
    /// owned elsewhere → `RawSlice<u8>` (centralises the outlives-holder
    /// invariant; see `version_buf()`).
    pub version_buf: bun_ptr::RawSlice<u8>,
    pub package_id: PackageID,
    pub is_aliased: bool,
    pub failed: bool,
    /// This must be cloned to handle when the AST store resets
    // TODO(port): lifetime — ARENA-owned (AST Expr.Data store); raw ptr per LIFETIMES.tsv
    pub e_string: Option<*mut js_ast::E::String>,
}

impl Default for UpdateRequest {
    fn default() -> Self {
        Self {
            name: b"",
            name_hash: 0,
            version: dependency::Version::default(),
            version_buf: bun_ptr::RawSlice::EMPTY,
            package_id: INVALID_PACKAGE_ID,
            is_aliased: false,
            failed: false,
            e_string: None,
        }
    }
}

pub type Array = Vec<UpdateRequest>;

impl UpdateRequest {
    /// Borrow the backing string buffer.
    ///
    /// SAFETY for callers: the buffer this points into (leaked CLI input, or
    /// `lockfile.buffers.string_bytes` after `clean_with_logger`) must outlive
    /// the returned slice and must not be reallocated while the borrow is
    /// live. Both invariants hold on every call path today — `string_bytes`
    /// is finalized before assignment in `clean_with_logger`, and the lockfile
    /// is threaded alongside `updates` everywhere they are read.
    #[inline]
    pub fn version_buf(&self) -> &[u8] {
        // See fn doc. `RawSlice` encapsulates the deref under the
        // outlives-holder invariant; `Default` seeds it as `EMPTY` and every
        // assignment is `RawSlice::new(&[u8])`.
        self.version_buf.slice()
    }

    #[inline]
    pub fn matches(&self, dependency: &Dependency, string_buf: &[u8]) -> bool {
        self.name_hash
            == if self.name.is_empty() {
                StringBuilder::string_hash(dependency.version.literal.slice(string_buf))
            } else {
                dependency.name_hash
            }
    }

    pub fn get_name(&self) -> &[u8] {
        if self.is_aliased {
            self.name
        } else {
            self.version.literal.slice(self.version_buf())
        }
    }

    /// If `self.package_id` is not `invalid_package_id`, it must be less than `lockfile.packages.len`.
    pub fn get_name_in_lockfile<'a>(&'a self, lockfile: &'a Lockfile) -> Option<&'a [u8]> {
        if self.package_id == INVALID_PACKAGE_ID {
            None
        } else {
            Some(lockfile.packages.items_name()[self.package_id as usize].slice(self.version_buf()))
        }
    }

    /// It is incorrect to call this function before Lockfile.cleanWithLogger() because
    /// resolved_name should be populated if possible.
    ///
    /// `self` needs to be a pointer! If `self` is a copy and the name returned from
    /// resolved_name is inlined, you will return a pointer to stack memory.
    pub fn get_resolved_name<'a>(&'a self, lockfile: &'a Lockfile) -> &'a [u8] {
        if self.is_aliased {
            self.name
        } else if let Some(name) = self.get_name_in_lockfile(lockfile) {
            name
        } else {
            self.version.literal.slice(self.version_buf())
        }
    }

    // NOTE: `pub const fromJS = @import("../../install_jsc/update_request_jsc.zig").fromJS;`
    // deleted — in Rust, `from_js` lives on an extension trait in the `*_jsc` crate.

    pub fn parse<'a>(
        pm: Option<&mut PackageManager>,
        log: &mut Log,
        positionals: &[&[u8]],
        update_requests: &'a mut Array,
        subcommand: Subcommand,
    ) -> &'a mut [UpdateRequest] {
        Self::parse_with_error(pm, log, positionals, update_requests, subcommand, true)
            .unwrap_or_else(|_| Global::crash())
    }

    // TODO(port): narrow error set — only `UnrecognizedDependencyFormat` is returned
    pub fn parse_with_error<'a>(
        mut pm: Option<&mut PackageManager>,
        log: &mut Log,
        positionals: &[&[u8]],
        update_requests: &'a mut Array,
        subcommand: Subcommand,
        fatal: bool,
    ) -> Result<&'a mut [UpdateRequest], bun_core::Error> {
        // first one is always either:
        // add
        // remove
        'outer: for positional in positionals {
            let mut input: Vec<u8> = strings::trim(positional, b" \n\r\t").to_vec();
            {
                // Replacing "\\\\" (2 bytes) with "/" (1 byte) never grows the string, so a
                // buffer of `input.len` bytes is always sufficient. Previously this was a
                // fixed `[2048]u8` stack array which overflowed for longer positionals.
                let mut temp = vec![0u8; input.len()];
                // std.mem.replace(u8, input, "\\\\", "/", temp) — returns replacement count
                let len = strings::replace(&input, b"\\\\", b"/", &mut temp);
                let new_len = input.len() - len;
                let input2 = &mut temp[..new_len];
                bun_paths::resolve_path::platform_to_posix_in_place(input2);
                input[..new_len].copy_from_slice(input2);
                input.truncate(new_len);
            }
            match subcommand {
                Subcommand::Link | Subcommand::Unlink => {
                    if !input.starts_with(b"link:") {
                        let mut buf = Vec::with_capacity(input.len() * 2 + 6);
                        write!(&mut buf, "{0}@link:{0}", bstr::BStr::new(&input))
                            .expect("unreachable");
                        input = buf;
                    }
                }
                _ => {}
            }

            // PORT NOTE: reshaped for borrowck — leak `input` now so sub-slices are &'static.
            // Zig: `bun.default_allocator.dupe(u8, ..)` with no matching free; these live for
            // the CLI invocation. `version_buf` is later reassigned to point at lockfile
            // buffers (lockfile.rs), so the field is a raw `*const [u8]` (ARENA-class per
            // PORTING.md type map) rather than `Box<[u8]>`.
            let input: &'static [u8] = input.leak();

            let mut value: &'static [u8] = input;
            let mut alias: Option<&'static [u8]> = None;
            if !Dependency::is_tarball(input) && strings::is_npm_package_name(input) {
                alias = Some(input);
                value = &input[input.len()..];
            } else if input.len() > 1 {
                if let Some(at) = strings::index_of_char(&input[1..], b'@') {
                    let name = &input[0..at as usize + 1];
                    if strings::is_npm_package_name(name) {
                        alias = Some(name);
                        value = &input[at as usize + 2..];
                    }
                }
            }

            let placeholder = SemverString::from(b"@@@");
            let Some(mut version) = Dependency::parse_with_optional_tag(
                if let Some(name) = alias {
                    SemverString::init(input, name)
                } else {
                    placeholder
                },
                alias.map(|name| StringBuilder::string_hash(name)),
                value,
                None,
                &mut SlicedString::init(input, value),
                Some(&mut *log),
                pm.as_deref_mut(),
            ) else {
                if fatal {
                    Output::err_generic(
                        "unrecognised dependency format: {}",
                        format_args!("{}", bstr::BStr::new(positional)),
                    );
                } else {
                    log.add_error_fmt(
                        None,
                        Loc::EMPTY,
                        format_args!(
                            "unrecognised dependency format: {}",
                            bstr::BStr::new(positional)
                        ),
                    );
                }

                return Err(bun_core::err!("UnrecognizedDependencyFormat"));
            };
            // TODO(port): Dependency.Version tag/value layout — Zig uses separate .tag + .value union
            if alias.is_some() && version.tag == dependency::version::Tag::Git {
                if let Some(ver) = Dependency::parse_with_optional_tag(
                    placeholder,
                    None,
                    input,
                    None,
                    &mut SlicedString::init(input, input),
                    Some(&mut *log),
                    pm.as_deref_mut(),
                ) {
                    alias = None;
                    version = ver;
                }
            }
            if match version.tag {
                dependency::version::Tag::DistTag => {
                    version.dist_tag().name.eql(placeholder, input, input)
                }
                dependency::version::Tag::Npm => version.npm().name.eql(placeholder, input, input),
                _ => false,
            } {
                if fatal {
                    Output::err_generic(
                        "unrecognised dependency format: {}",
                        format_args!("{}", bstr::BStr::new(positional)),
                    );
                } else {
                    log.add_error_fmt(
                        None,
                        Loc::EMPTY,
                        format_args!(
                            "unrecognised dependency format: {}",
                            bstr::BStr::new(positional)
                        ),
                    );
                }

                return Err(bun_core::err!("UnrecognizedDependencyFormat"));
            }

            let mut request = UpdateRequest {
                version,
                version_buf: bun_ptr::RawSlice::new(input),
                ..UpdateRequest::default()
            };
            if let Some(name) = alias {
                request.is_aliased = true;
                // Zig: `allocator.dupe(u8, name) catch unreachable` — never freed (CLI lifetime).
                request.name = name.to_vec().leak();
                request.name_hash = StringBuilder::string_hash(name);
            } else if request.version.tag == dependency::version::Tag::Github
                && request.version.github().committish.is_empty()
            {
                request.name_hash =
                    StringBuilder::string_hash(request.version.literal.slice(input));
            } else {
                request.name_hash =
                    StringBuilder::string_hash(request.version.literal.slice(input));
            }

            for prev in update_requests.iter() {
                if prev.name_hash == request.name_hash && request.name.len() == prev.name.len() {
                    continue 'outer;
                }
            }
            update_requests.push(request);
        }

        Ok(update_requests.as_mut_slice())
    }
}

pub use super::Subcommand;
pub use bun_install::package_manager::Options;
pub use bun_install::package_manager::command_line_arguments as CommandLineArguments;

// ported from: src/install/PackageManager/UpdateRequest.zig
