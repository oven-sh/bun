use core::ffi::CStr;

use bstr::BStr;

use bun_core::output;
use bun_install::lockfile::{Lockfile, StringBuilder as LockfileStringBuilder};
use bun_install::lockfile::package::Package;
use bun_install::lockfile::Scripts as LockfileScripts;
use bun_install::{initialize_store, Resolution};
use bun_js_parser::Expr;
use bun_logger as logger;
use bun_paths::{self, AbsPath, PathBuffer, SEP_STR};
use bun_semver::String as SemverString;
use bun_str::{strings, ZString};
use bun_sys::{self, Fd};

bun_output::declare_scope!(Lockfile, hidden);

// TODO(port): verify const name/path — Zig: `Lockfile.Scripts.names.len`
const SCRIPT_NAMES_LEN: usize = LockfileScripts::NAMES.len();

#[repr(C)]
#[derive(Default)]
pub struct Scripts {
    pub preinstall: SemverString,
    pub install: SemverString,
    pub postinstall: SemverString,
    pub preprepare: SemverString,
    pub prepare: SemverString,
    pub postprepare: SemverString,
    pub filled: bool,
}

impl Scripts {
    /// Helper: indexed access matching `Lockfile.Scripts.names` order.
    /// Zig used `@field(this, hook)` over `Lockfile.Scripts.names`; Rust has no
    /// field-by-name reflection, so we tabulate the 6 hooks explicitly.
    #[inline]
    fn hooks(&self) -> [&SemverString; SCRIPT_NAMES_LEN] {
        [
            &self.preinstall,
            &self.install,
            &self.postinstall,
            &self.preprepare,
            &self.prepare,
            &self.postprepare,
        ]
    }

    #[inline]
    fn hooks_mut(&mut self) -> [&mut SemverString; SCRIPT_NAMES_LEN] {
        [
            &mut self.preinstall,
            &mut self.install,
            &mut self.postinstall,
            &mut self.preprepare,
            &mut self.prepare,
            &mut self.postprepare,
        ]
    }

    pub fn eql(l: &Scripts, r: &Scripts, l_buf: &[u8], r_buf: &[u8]) -> bool {
        l.preinstall.eql(&r.preinstall, l_buf, r_buf)
            && l.install.eql(&r.install, l_buf, r_buf)
            && l.postinstall.eql(&r.postinstall, l_buf, r_buf)
            && l.preprepare.eql(&r.preprepare, l_buf, r_buf)
            && l.prepare.eql(&r.prepare, l_buf, r_buf)
            && l.postprepare.eql(&r.postprepare, l_buf, r_buf)
    }

    // TODO(port): Zig signature is `(comptime Builder: type, builder: Builder)`.
    // Callers pass either `*Lockfile.StringBuilder` or similar; bound left loose
    // for Phase B to tighten (needs `.append::<SemverString>(&[u8]) -> SemverString`).
    pub fn clone<B>(&self, buf: &[u8], builder: &mut B) -> Scripts
    where
        B: LockfileStringBuilderLike,
    {
        if !self.filled {
            return Scripts::default();
        }
        let mut scripts = Scripts {
            filled: true,
            ..Scripts::default()
        };
        for (dst, src) in scripts.hooks_mut().into_iter().zip(self.hooks()) {
            *dst = builder.append_string(src.slice(buf));
        }
        // PERF(port): was `inline for` over comptime name list — profile in Phase B
        scripts
    }

    pub fn count<B>(&self, buf: &[u8], builder: &mut B)
    where
        B: LockfileStringBuilderLike,
    {
        for hook in self.hooks() {
            builder.count(hook.slice(buf));
        }
        // PERF(port): was `inline for` over comptime name list — profile in Phase B
    }

    pub fn has_any(&self) -> bool {
        for hook in self.hooks() {
            if !hook.is_empty() {
                return true;
            }
        }
        false
    }

    /// return: (first_index, total, entries)
    pub fn get_script_entries(
        &self,
        lockfile: &Lockfile,
        lockfile_buf: &[u8],
        resolution_tag: Resolution::Tag,
        add_node_gyp_rebuild_script: bool,
    ) -> (i8, u8, [Option<Box<[u8]>>; SCRIPT_NAMES_LEN]) {
        // `lockfile.allocator` dropped — global mimalloc; `Box::from` dupes.
        let _ = lockfile;
        let mut script_index: u8 = 0;
        let mut first_script_index: i8 = -1;
        let mut scripts: [Option<Box<[u8]>>; 6] = [const { None }; 6];
        let mut counter: u8 = 0;

        if add_node_gyp_rebuild_script {
            {
                script_index += 1;
                if first_script_index == -1 {
                    first_script_index = i8::try_from(script_index).unwrap();
                }
                scripts[script_index as usize] =
                    Some(Box::<[u8]>::from(b"node-gyp rebuild".as_slice()));
                script_index += 1;
                counter += 1;
            }

            // missing install and preinstall, only need to check postinstall
            if !self.postinstall.is_empty() {
                if first_script_index == -1 {
                    first_script_index = i8::try_from(script_index).unwrap();
                }
                scripts[script_index as usize] =
                    Some(Box::<[u8]>::from(self.preinstall.slice(lockfile_buf)));
                counter += 1;
            }
            script_index += 1;
        } else {
            let install_scripts = [&self.preinstall, &self.install, &self.postinstall];

            for script in install_scripts {
                if !script.is_empty() {
                    if first_script_index == -1 {
                        first_script_index = i8::try_from(script_index).unwrap();
                    }
                    scripts[script_index as usize] =
                        Some(Box::<[u8]>::from(script.slice(lockfile_buf)));
                    counter += 1;
                }
                script_index += 1;
            }
            // PERF(port): was `inline for` over tuple — profile in Phase B
        }

        match resolution_tag {
            Resolution::Tag::Git | Resolution::Tag::Github | Resolution::Tag::Root => {
                let prepare_scripts = [&self.preprepare, &self.prepare, &self.postprepare];

                for script in prepare_scripts {
                    if !script.is_empty() {
                        if first_script_index == -1 {
                            first_script_index = i8::try_from(script_index).unwrap();
                        }
                        scripts[script_index as usize] =
                            Some(Box::<[u8]>::from(script.slice(lockfile_buf)));
                        counter += 1;
                    }
                    script_index += 1;
                }
                // PERF(port): was `inline for` over tuple — profile in Phase B
            }
            Resolution::Tag::Workspace => {
                script_index += 1;
                if !self.prepare.is_empty() {
                    if first_script_index == -1 {
                        first_script_index = i8::try_from(script_index).unwrap();
                    }
                    scripts[script_index as usize] =
                        Some(Box::<[u8]>::from(self.prepare.slice(lockfile_buf)));
                    counter += 1;
                }
                script_index += 2;
            }
            _ => {}
        }

        (first_script_index, counter, scripts)
    }

    pub fn create_list(
        &self,
        lockfile: &Lockfile,
        lockfile_buf: &[u8],
        // TODO(port): `bun.AbsPath(.{ .sep = .auto })` — verify Rust type in bun_paths
        cwd_: &mut AbsPath,
        package_name: &[u8],
        resolution_tag: Resolution::Tag,
        add_node_gyp_rebuild_script: bool,
    ) -> Option<List> {
        let (first_index, total, scripts) = self.get_script_entries(
            lockfile,
            lockfile_buf,
            resolution_tag,
            add_node_gyp_rebuild_script,
        );
        if first_index != -1 {
            #[cfg(windows)]
            let mut cwd_buf = bun_paths::PathBuffer::uninit();

            #[cfg(not(windows))]
            let cwd: &[u8] = cwd_.slice();

            #[cfg(windows)]
            let cwd: &[u8] = 'brk: {
                let Ok(cwd_handle) = bun_sys::open_dir_no_renaming_or_deleting_windows(
                    Fd::INVALID,
                    cwd_.slice_z(),
                ) else {
                    break 'brk cwd_.slice();
                };
                match Fd::from_std_dir(cwd_handle).get_fd_path(&mut cwd_buf) {
                    Ok(p) => p,
                    Err(_) => cwd_.slice(),
                }
            };

            return Some(List {
                items: scripts,
                first_index: u8::try_from(first_index).unwrap(),
                total,
                // Zig `allocator.dupeZ(u8, cwd)` — owned NUL-terminated copy.
                // TODO(port): verify owned-ZStr constructor name in bun_str (ZString::from_bytes)
                cwd: ZString::from_bytes(cwd),
                package_name: Box::<[u8]>::from(package_name),
            });
        }

        None
    }

    pub fn parse_count(builder: &mut LockfileStringBuilder, json: Expr) {
        if let Some(scripts_prop) = json.as_property(b"scripts") {
            if scripts_prop.expr.data.is_e_object() {
                for script_name in LockfileScripts::NAMES {
                    if let Some(script) = scripts_prop.expr.get(script_name) {
                        if let Some(input) = script.as_string() {
                            builder.count(input);
                        }
                    }
                }
                // PERF(port): was `inline for` over comptime name list — profile in Phase B
            }
        }
    }

    pub fn parse_alloc(&mut self, builder: &mut LockfileStringBuilder, json: Expr) {
        if let Some(scripts_prop) = json.as_property(b"scripts") {
            if scripts_prop.expr.data.is_e_object() {
                let dsts = self.hooks_mut();
                for (dst, script_name) in dsts.into_iter().zip(LockfileScripts::NAMES) {
                    if let Some(script) = scripts_prop.expr.get(script_name) {
                        if let Some(input) = script.as_string() {
                            *dst = builder.append::<SemverString>(input);
                        }
                    }
                }
                // PERF(port): was `inline for` + `@field` — profile in Phase B
            }
        }
    }

    pub fn get_list(
        &mut self,
        log: &mut logger::Log,
        lockfile: &Lockfile,
        folder_path: &mut AbsPath,
        folder_name: &[u8],
        resolution: &Resolution,
    ) -> Result<Option<List>, bun_core::Error> {
        // TODO(port): narrow error set
        if self.has_any() {
            let add_node_gyp_rebuild_script = if lockfile
                .has_trusted_dependency(folder_name, resolution)
                && self.install.is_empty()
                && self.preinstall.is_empty()
            {
                let save = folder_path.save();
                // `defer save.restore()` — AbsPath::save() returns RAII guard that restores on Drop.
                // TODO(port): verify AbsPath::save() guard semantics in bun_paths
                folder_path.append(b"binding.gyp");

                let r = bun_sys::exists(folder_path.slice());
                drop(save);
                r
            } else {
                false
            };

            return Ok(self.create_list(
                lockfile,
                lockfile.buffers.string_bytes.as_slice(),
                folder_path,
                folder_name,
                resolution.tag,
                add_node_gyp_rebuild_script,
            ));
        } else if !self.filled {
            return self.create_from_package_json(
                log,
                lockfile,
                folder_path,
                folder_name,
                resolution.tag,
            );
        }

        Ok(None)
    }

    pub fn fill_from_package_json(
        &mut self,
        string_builder: &mut LockfileStringBuilder,
        log: &mut logger::Log,
        folder_path: &mut AbsPath,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let json = {
            let save = folder_path.save();
            folder_path.append(b"package.json");

            let json_src = {
                let buf = bun_sys::File::read_from(Fd::cwd(), folder_path.slice_z())
                    .unwrap_err_into()?;
                // TODO(port): verify bun_sys::File::read_from signature & Maybe→Result mapping
                logger::Source::init_path_string(folder_path.slice(), buf)
            };

            initialize_store();
            let r = bun_json::parse_package_json_utf8(&json_src, log)?;
            drop(save);
            r
        };

        Scripts::parse_count(string_builder, json);
        string_builder.allocate()?;
        self.parse_alloc(string_builder, json);
        self.filled = true;
        Ok(())
    }

    pub fn create_from_package_json(
        &mut self,
        log: &mut logger::Log,
        lockfile: &Lockfile,
        folder_path: &mut AbsPath,
        folder_name: &[u8],
        resolution_tag: Resolution::Tag,
    ) -> Result<Option<List>, bun_core::Error> {
        // TODO(port): narrow error set
        let mut tmp = Lockfile::init_empty();
        // `defer tmp.deinit()` — Lockfile impls Drop
        let mut builder = tmp.string_builder();
        self.fill_from_package_json(&mut builder, log, folder_path)?;

        let add_node_gyp_rebuild_script = if self.install.is_empty() && self.preinstall.is_empty() {
            let save = folder_path.save();
            folder_path.append(b"binding.gyp");

            let r = bun_sys::exists(folder_path.slice());
            drop(save);
            r
        } else {
            false
        };

        Ok(self.create_list(
            lockfile,
            tmp.buffers.string_bytes.as_slice(),
            folder_path,
            folder_name,
            resolution_tag,
            add_node_gyp_rebuild_script,
        ))
    }
}

// ─── Scripts.List ────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PrintFormat {
    Completed,
    Info,
    Untrusted,
}

pub struct List {
    pub items: [Option<Box<[u8]>>; SCRIPT_NAMES_LEN],
    pub first_index: u8,
    pub total: u8,
    // Zig `stringZ` ([:0]const u8) owned via `allocator.dupeZ`; (commented-out)
    // deinit frees it → owned NUL-terminated heap string, not a borrow.
    // TODO(port): verify exact bun_str owned-ZStr type name (ZString) in Phase B.
    pub cwd: ZString,
    pub package_name: Box<[u8]>,
}

impl List {
    pub fn print_scripts(
        &self,
        resolution: &Resolution,
        resolution_buf: &[u8],
        format_type: PrintFormat,
    ) {
        // PERF(port): was comptime enum param — profile in Phase B
        let needle = const_format::concatcp!(SEP_STR, "node_modules", SEP_STR).as_bytes();
        if let Some(i) = strings::index_of(self.cwd.as_bytes(), needle) {
            output::pretty!(
                "<d>.{s}{s} @{f}<r>\n",
                BStr::new(SEP_STR.as_bytes()),
                BStr::new(strings::without_trailing_slash(&self.cwd.as_bytes()[i + 1..])),
                resolution.fmt(resolution_buf, bun_paths::Style::Posix),
            );
        } else {
            output::pretty!(
                "<d>{s} @{f}<r>\n",
                BStr::new(strings::without_trailing_slash(self.cwd.as_bytes())),
                resolution.fmt(resolution_buf, bun_paths::Style::Posix),
            );
        }

        for (script_index, maybe_script) in self.items.iter().enumerate() {
            if let Some(script) = maybe_script {
                let name = LockfileScripts::NAMES[script_index];
                match format_type {
                    PrintFormat::Completed => output::pretty!(
                        " <green>✓<r> [{s}]<d>:<r> <cyan>{s}<r>\n",
                        BStr::new(name),
                        BStr::new(script),
                    ),
                    PrintFormat::Untrusted => output::pretty!(
                        " <yellow>»<r> [{s}]<d>:<r> <cyan>{s}<r>\n",
                        BStr::new(name),
                        BStr::new(script),
                    ),
                    PrintFormat::Info => output::pretty!(
                        " [{s}]<d>:<r> <cyan>{s}<r>\n",
                        BStr::new(name),
                        BStr::new(script),
                    ),
                }
            }
        }
    }

    pub fn first(&self) -> &[u8] {
        if cfg!(debug_assertions) {
            debug_assert!(self.items[self.first_index as usize].is_some());
        }
        self.items[self.first_index as usize].as_ref().unwrap()
    }

    // pub fn deinit(this: Package.Scripts.List, allocator: std.mem.Allocator) void {
    //     for (this.items) |maybe_item| {
    //         if (maybe_item) |item| {
    //             allocator.free(item);
    //         }
    //     }
    //
    //     allocator.free(this.cwd);
    // }
    // (Commented out in Zig too; Box<[u8]> fields drop automatically.)

    pub fn append_to_lockfile(&self, lockfile: &mut Lockfile) {
        for (i, maybe_script) in self.items.iter().enumerate() {
            if let Some(script) = maybe_script {
                bun_output::scoped_log!(
                    Lockfile,
                    "enqueue({}, {}) in {}",
                    "prepare",
                    BStr::new(&self.package_name),
                    BStr::new(self.cwd.as_bytes()),
                );
                // TODO(port): `@field(lockfile.scripts, Lockfile.Scripts.names[i])` —
                // needs indexed mut access on `lockfile.scripts` (e.g. `hook_mut(i)`).
                lockfile.scripts.hook_mut(i).push(script.to_vec());
                // PERF(port): was `inline for` + appendAssumeCapacity-style — profile in Phase B
            }
        }
    }
}

// ─── support trait (Phase B: move/merge into bun_install::lockfile) ─────────

// TODO(port): Zig passed `comptime Builder: type, builder: Builder` to `clone`/
// `count`. Real callers are `*Lockfile.StringBuilder` and similar. Define the
// minimal surface here; Phase B replaces with the concrete trait/type.
pub trait LockfileStringBuilderLike {
    fn count(&mut self, s: &[u8]);
    fn append_string(&mut self, s: &[u8]) -> SemverString;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/lockfile/Package/Scripts.zig (384 lines)
//   confidence: medium
//   todos:      12
//   notes:      @field reflection over hook names tabulated via hooks()/hooks_mut(); owned ZString type for `cwd`, AbsPath save/restore RAII, and lockfile.scripts indexed access need Phase B verification
// ──────────────────────────────────────────────────────────────────────────
