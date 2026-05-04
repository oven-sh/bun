use std::io::Write as _;

use bun_core::{Global, Output};
use bun_logger::{self as logger, Log, Loc};
use bun_str::strings;
use bun_semver::{SlicedString, String as SemverString};
use bun_js_parser as js_ast;

use bun_install::{
    Dependency, Lockfile, PackageID, PackageNameHash, INVALID_PACKAGE_ID,
    PackageManager,
};
use bun_install::dependency;

pub struct UpdateRequest {
    // TODO(port): lifetime — Zig leaks these (no deinit); using &'static for now
    pub name: &'static [u8],
    pub name_hash: PackageNameHash,
    pub version: dependency::Version,
    pub version_buf: &'static [u8],
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
            version_buf: b"",
            package_id: INVALID_PACKAGE_ID,
            is_aliased: false,
            failed: false,
            e_string: None,
        }
    }
}

pub type Array = Vec<UpdateRequest>;

impl UpdateRequest {
    #[inline]
    pub fn matches(&self, dependency: &Dependency, string_buf: &[u8]) -> bool {
        self.name_hash
            == if self.name.is_empty() {
                SemverString::Builder::string_hash(dependency.version.literal.slice(string_buf))
            } else {
                dependency.name_hash
            }
    }

    pub fn get_name(&self) -> &[u8] {
        if self.is_aliased {
            self.name
        } else {
            self.version.literal.slice(self.version_buf)
        }
    }

    /// If `self.package_id` is not `invalid_package_id`, it must be less than `lockfile.packages.len`.
    pub fn get_name_in_lockfile<'a>(&'a self, lockfile: &Lockfile) -> Option<&'a [u8]> {
        if self.package_id == INVALID_PACKAGE_ID {
            None
        } else {
            // TODO(port): MultiArrayList column accessor — Zig: lockfile.packages.items(.name)[id]
            Some(lockfile.packages.items_name()[usize::from(self.package_id)].slice(self.version_buf))
        }
    }

    /// It is incorrect to call this function before Lockfile.cleanWithLogger() because
    /// resolved_name should be populated if possible.
    ///
    /// `self` needs to be a pointer! If `self` is a copy and the name returned from
    /// resolved_name is inlined, you will return a pointer to stack memory.
    pub fn get_resolved_name<'a>(&'a self, lockfile: &Lockfile) -> &'a [u8] {
        if self.is_aliased {
            self.name
        } else if let Some(name) = self.get_name_in_lockfile(lockfile) {
            name
        } else {
            self.version.literal.slice(self.version_buf)
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
                // TODO(port): std.mem.replace(u8, input, "\\\\", "/", temp) — returns replacement count
                let len = bun_str::mem::replace(&input, b"\\\\", b"/", &mut temp);
                let new_len = input.len() - len;
                let input2 = &mut temp[..new_len];
                bun_paths::platform_to_posix_in_place(input2);
                input[..new_len].copy_from_slice(input2);
                input.truncate(new_len);
            }
            match subcommand {
                Subcommand::Link | Subcommand::Unlink => {
                    if !input.starts_with(b"link:") {
                        let mut buf = Vec::with_capacity(input.len() * 2 + 6);
                        write!(
                            &mut buf,
                            "{0}@link:{0}",
                            bstr::BStr::new(&input)
                        )
                        .expect("unreachable");
                        input = buf;
                    }
                }
                _ => {}
            }

            // PORT NOTE: reshaped for borrowck — leak `input` now so sub-slices are &'static
            // (Zig never frees these; they live for the CLI invocation).
            let input: &'static [u8] = Box::leak(input.into_boxed_slice());

            let mut value: &'static [u8] = input;
            let mut alias: Option<&'static [u8]> = None;
            if !Dependency::is_tarball(input) && strings::is_npm_package_name(input) {
                alias = Some(input);
                value = &input[input.len()..];
            } else if input.len() > 1 {
                if let Some(at) = strings::index_of_char(&input[1..], b'@') {
                    let name = &input[0..usize::from(at) + 1];
                    if strings::is_npm_package_name(name) {
                        alias = Some(name);
                        value = &input[usize::from(at) + 2..];
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
                alias.map(|name| SemverString::Builder::string_hash(name)),
                value,
                None,
                &mut SlicedString::init(input, value),
                log,
                pm.as_deref_mut(),
            ) else {
                if fatal {
                    Output::err_generic(format_args!(
                        "unrecognised dependency format: {}",
                        bstr::BStr::new(positional)
                    ));
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
                    log,
                    pm.as_deref_mut(),
                ) {
                    alias = None;
                    version = ver;
                }
            }
            if match version.tag {
                dependency::version::Tag::DistTag => {
                    version.value.dist_tag.name.eql(&placeholder, input, input)
                }
                dependency::version::Tag::Npm => {
                    version.value.npm.name.eql(&placeholder, input, input)
                }
                _ => false,
            } {
                if fatal {
                    Output::err_generic(format_args!(
                        "unrecognised dependency format: {}",
                        bstr::BStr::new(positional)
                    ));
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
                version_buf: input,
                ..UpdateRequest::default()
            };
            if let Some(name) = alias {
                request.is_aliased = true;
                request.name = Box::leak(Box::<[u8]>::from(name));
                request.name_hash = SemverString::Builder::string_hash(name);
            } else if request.version.tag == dependency::version::Tag::Github
                && request.version.value.github.committish.is_empty()
            {
                request.name_hash =
                    SemverString::Builder::string_hash(request.version.literal.slice(input));
            } else {
                request.name_hash =
                    SemverString::Builder::string_hash(request.version.literal.slice(input));
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

pub use bun_install::package_manager::CommandLineArguments;
pub use bun_install::package_manager::Options;
pub use bun_install::package_manager::PackageInstaller;
pub use bun_install::package_manager::PackageJSONEditor;
pub use bun_install::package_manager::Subcommand;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/PackageManager/UpdateRequest.zig (218 lines)
//   confidence: medium
//   todos:      6
//   notes:      name/version_buf leaked as &'static (no deinit in Zig); Dependency.Version tag+value union access needs Phase-B reshape; std.mem.replace stubbed
// ──────────────────────────────────────────────────────────────────────────
