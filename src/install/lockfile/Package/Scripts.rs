use bstr::BStr;

use bun_core::ZBox;
use bun_core::fmt::PathSep;
use bun_core::strings;
use bun_install::lockfile::Lockfile;
use bun_install::lockfile::Scripts as LockfileScripts;
use bun_install::{Resolution, ResolutionTag, initialize_store};
use bun_paths::{self, SEP_STR};
use bun_semver::String as SemverString;
use bun_sys::{self, Fd};

use crate::bun_json::{self, Expr};
// The only concrete builder instantiation in install is the lockfile's,
// so we take `crate::lockfile_real::StringBuilder` directly (matches Meta.rs).
use crate::lockfile_real::{Lockfile as RealLockfile, StringBuilder as LockfileStringBuilder};

bun_output::declare_scope!(Lockfile, hidden);

const SCRIPT_NAMES_LEN: usize = LockfileScripts::NAMES.len();

#[repr(C)]
#[derive(Default, Clone, Copy)]
pub struct Scripts {
    pub(crate) preinstall: SemverString,
    pub(crate) install: SemverString,
    pub(crate) postinstall: SemverString,
    pub(crate) preprepare: SemverString,
    pub(crate) prepare: SemverString,
    pub(crate) postprepare: SemverString,
    pub(crate) filled: bool,
}

impl Scripts {
    /// (name, getter) table used by debug JSON serialization in place of
    /// field reflection.
    pub(crate) const FIELD_NAMES: &'static [(&'static str, fn(&Scripts) -> &SemverString)] = &[
        (LockfileScripts::NAMES[0], |s| &s.preinstall),
        (LockfileScripts::NAMES[1], |s| &s.install),
        (LockfileScripts::NAMES[2], |s| &s.postinstall),
        (LockfileScripts::NAMES[3], |s| &s.preprepare),
        (LockfileScripts::NAMES[4], |s| &s.prepare),
        (LockfileScripts::NAMES[5], |s| &s.postprepare),
    ];

    /// Helper: indexed access matching `Lockfile.Scripts.names` order.
    /// The 6 hooks are tabulated explicitly (no field-by-name reflection).
    #[inline]
    pub(crate) fn hooks(&self) -> [&SemverString; SCRIPT_NAMES_LEN] {
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
    pub(crate) fn hooks_mut(&mut self) -> [&mut SemverString; SCRIPT_NAMES_LEN] {
        [
            &mut self.preinstall,
            &mut self.install,
            &mut self.postinstall,
            &mut self.preprepare,
            &mut self.prepare,
            &mut self.postprepare,
        ]
    }

    pub(crate) fn eql(&self, r: &Scripts, l_buf: &[u8], r_buf: &[u8]) -> bool {
        self.preinstall.eql(r.preinstall, l_buf, r_buf)
            && self.install.eql(r.install, l_buf, r_buf)
            && self.postinstall.eql(r.postinstall, l_buf, r_buf)
            && self.preprepare.eql(r.preprepare, l_buf, r_buf)
            && self.prepare.eql(r.prepare, l_buf, r_buf)
            && self.postprepare.eql(r.postprepare, l_buf, r_buf)
    }

    /// Named `clone_into` (not `clone`) to avoid shadowing `Clone::clone`.
    pub(crate) fn clone_into(&self, buf: &[u8], builder: &mut LockfileStringBuilder<'_>) -> Scripts {
        if !self.filled {
            return Scripts::default();
        }
        let mut scripts = Scripts {
            filled: true,
            ..Scripts::default()
        };
        for (dst, src) in scripts.hooks_mut().into_iter().zip(self.hooks()) {
            *dst = builder.append::<SemverString>(src.slice(buf));
        }
        scripts
    }

    pub(crate) fn count(&self, buf: &[u8], builder: &mut LockfileStringBuilder<'_>) {
        for hook in self.hooks() {
            builder.count(hook.slice(buf));
        }
    }

    pub(crate) fn has_any(&self) -> bool {
        for hook in self.hooks() {
            if !hook.is_empty() {
                return true;
            }
        }
        false
    }

    /// return: (first_index, total, entries)
    /// Takes only `lockfile_buf` (not the whole `Lockfile`) so callers can
    /// split-borrow `lockfile.{packages, scripts}`.
    pub(crate) fn get_script_entries(
        &self,
        lockfile_buf: &[u8],
        resolution_tag: ResolutionTag,
        add_node_gyp_rebuild_script: bool,
    ) -> (i8, u8, [Option<Box<[u8]>>; SCRIPT_NAMES_LEN]) {
        let mut script_index: u8 = 0;
        let mut first_script_index: i8 = -1;
        let mut scripts: [Option<Box<[u8]>>; 6] = [const { None }; 6];
        let mut counter: u8 = 0;

        if add_node_gyp_rebuild_script {
            {
                script_index += 1;
                if first_script_index == -1 {
                    first_script_index = i8::try_from(script_index).expect("int cast");
                }
                scripts[script_index as usize] =
                    Some(Box::<[u8]>::from(b"node-gyp rebuild".as_slice()));
                script_index += 1;
                counter += 1;
            }

            // missing install and preinstall, only need to check postinstall
            if !self.postinstall.is_empty() {
                if first_script_index == -1 {
                    first_script_index = i8::try_from(script_index).expect("int cast");
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
                        first_script_index = i8::try_from(script_index).expect("int cast");
                    }
                    scripts[script_index as usize] =
                        Some(Box::<[u8]>::from(script.slice(lockfile_buf)));
                    counter += 1;
                }
                script_index += 1;
            }
        }

        match resolution_tag {
            ResolutionTag::Git | ResolutionTag::Github | ResolutionTag::Root => {
                let prepare_scripts = [&self.preprepare, &self.prepare, &self.postprepare];

                for script in prepare_scripts {
                    if !script.is_empty() {
                        if first_script_index == -1 {
                            first_script_index = i8::try_from(script_index).expect("int cast");
                        }
                        scripts[script_index as usize] =
                            Some(Box::<[u8]>::from(script.slice(lockfile_buf)));
                        counter += 1;
                    }
                    script_index += 1;
                }
            }
            ResolutionTag::Workspace => {
                script_index += 1;
                if !self.prepare.is_empty() {
                    if first_script_index == -1 {
                        first_script_index = i8::try_from(script_index).expect("int cast");
                    }
                    scripts[script_index as usize] =
                        Some(Box::<[u8]>::from(self.prepare.slice(lockfile_buf)));
                    counter += 1;
                }
            }
            _ => {}
        }

        (first_script_index, counter, scripts)
    }

    pub(crate) fn create_list(
        &self,
        lockfile: &Lockfile,
        lockfile_buf: &[u8],
        cwd_: &mut bun_paths::AutoAbsPath,
        package_name: &[u8],
        resolution_tag: ResolutionTag,
        add_node_gyp_rebuild_script: bool,
    ) -> Option<List> {
        let _ = lockfile;
        let (first_index, total, scripts) =
            self.get_script_entries(lockfile_buf, resolution_tag, add_node_gyp_rebuild_script);
        if first_index != -1 {
            #[cfg(windows)]
            let mut cwd_buf = bun_paths::PathBuffer::uninit();

            #[cfg(not(windows))]
            let cwd: &[u8] = cwd_.slice();

            #[cfg(windows)]
            let cwd: &[u8] = 'brk: {
                let Ok(cwd_handle) =
                    bun_sys::open_dir_no_renaming_or_deleting_windows(Fd::INVALID, cwd_.slice_z())
                else {
                    break 'brk cwd_.slice();
                };
                // Resolve the canonical path, then close the directory HANDLE.
                // (`Fd` is `Copy` with no `Drop`, so without this explicit
                // close one kernel directory HANDLE leaks per script-bearing
                // package.)
                let path = bun_sys::get_fd_path(cwd_handle, &mut cwd_buf);
                let _ = bun_sys::close(cwd_handle);
                match path {
                    Ok(p) => p,
                    Err(_) => cwd_.slice(),
                }
            };

            return Some(List {
                items: scripts,
                first_index: u8::try_from(first_index).expect("int cast"),
                total,
                // Owned NUL-terminated copy.
                cwd: ZBox::from_bytes(cwd),
                package_name: Box::<[u8]>::from(package_name),
            });
        }

        None
    }

    // Generic over `bun_semver::StringBuilder`
    // so both `lockfile_real::StringBuilder` and `bun_semver::semver_string::Builder`
    // are accepted (both impl the trait).
    pub(crate) fn parse_count<B: bun_semver::StringBuilder>(builder: &mut B, json: Expr) {
        if let Some(scripts_prop) = json.as_property(b"scripts") {
            if scripts_prop.expr.is_object() {
                for script_name in LockfileScripts::NAMES {
                    if let Some(script) = scripts_prop.expr.get(script_name.as_bytes()) {
                        // The JSON parser
                        // produces UTF-8 `EString`s, so the alloc-free literal accessor
                        // is sufficient here.
                        if let Some(input) = script.as_utf8_string_literal() {
                            builder.count(input);
                        }
                    }
                }
            }
        }
    }

    pub(crate) fn parse_alloc<B: bun_semver::StringBuilder>(&mut self, builder: &mut B, json: Expr) {
        if let Some(scripts_prop) = json.as_property(b"scripts") {
            if scripts_prop.expr.is_object() {
                let dsts = self.hooks_mut();
                for (dst, script_name) in dsts.into_iter().zip(LockfileScripts::NAMES) {
                    if let Some(script) = scripts_prop.expr.get(script_name.as_bytes()) {
                        if let Some(input) = script.as_utf8_string_literal() {
                            *dst = builder.append::<SemverString>(input);
                        }
                    }
                }
            }
        }
    }

    pub fn get_list(
        &mut self,
        log: &mut bun_ast::Log,
        lockfile: &Lockfile,
        folder_path: &mut bun_paths::AutoAbsPath,
        folder_name: &[u8],
        resolution: &Resolution,
    ) -> Result<Option<List>, crate::Error> {
        if self.has_any() {
            let add_node_gyp_rebuild_script =
                if lockfile.has_trusted_dependency(folder_name, folder_name, resolution)
                    && self.install.is_empty()
                    && self.preinstall.is_empty()
                {
                    // `defer save.restore()` — `save()` returns an RAII guard that
                    // restores the path length on Drop and derefs to the path.
                    let mut save = folder_path.save();
                    let _ = save.append(b"binding.gyp");

                    bun_sys::exists(save.slice())
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

    pub(crate) fn fill_from_package_json(
        &mut self,
        string_builder: &mut LockfileStringBuilder<'_>,
        log: &mut bun_ast::Log,
        folder_path: &mut bun_paths::AutoAbsPath,
    ) -> Result<(), crate::Error> {
        let json_buf;
        let parsed;
        let json: Expr = {
            // `defer save.restore()` — `save()` returns an RAII guard that
            // restores the path length on Drop and derefs to the path.
            let mut save = folder_path.save();
            let _ = save.append(b"package.json");

            json_buf = bun_sys::File::read_from(Fd::cwd(), save.slice_z())?;
            let json_src = bun_ast::Source::init_path_string(save.slice(), json_buf.as_slice());

            initialize_store();
            parsed = bun_json::ParsedJson::parse_package_json(&json_src, log)?;
            parsed.root
        };

        Scripts::parse_count(string_builder, json);
        string_builder.allocate()?;
        self.parse_alloc(string_builder, json);
        self.filled = true;
        Ok(())
    }

    pub(crate) fn create_from_package_json(
        &mut self,
        log: &mut bun_ast::Log,
        lockfile: &Lockfile,
        folder_path: &mut bun_paths::AutoAbsPath,
        folder_name: &[u8],
        resolution_tag: ResolutionTag,
    ) -> Result<Option<List>, crate::Error> {
        let mut tmp = RealLockfile::init_empty_value();
        // `defer tmp.deinit()` — `tmp` stays empty (only `string_builder` borrows it), so field
        // auto-drop suffices; Lockfile has no `impl Drop`.
        let mut builder = tmp.string_builder();
        self.fill_from_package_json(&mut builder, log, folder_path)?;

        let add_node_gyp_rebuild_script = if self.install.is_empty() && self.preinstall.is_empty() {
            // `defer save.restore()` — `save()` returns an RAII guard that
            // restores the path length on Drop and derefs to the path.
            let mut save = folder_path.save();
            let _ = save.append(b"binding.gyp");

            bun_sys::exists(save.slice())
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

// `Clone` — `List` owns `cwd`/`package_name`/`items`, but
// `runTasks.rs` (`.run_scripts` arm) and `lifecycle_script_runner` need a
// by-value copy while the original allocation in `Store.entries.scripts`
// must stay live for the post-install pass, so a deep clone is required.
#[derive(Clone)]
pub struct List {
    pub items: [Option<Box<[u8]>>; SCRIPT_NAMES_LEN],
    pub(crate) first_index: u8,
    pub total: u8,
    // Owned NUL-terminated heap string, not a borrow.
    pub(crate) cwd: ZBox,
    pub(crate) package_name: Box<[u8]>,
}

impl List {
    pub fn print_scripts(
        &self,
        resolution: &Resolution,
        resolution_buf: &[u8],
        format_type: PrintFormat,
    ) {
        let needle = bun_paths::NODE_MODULES_NEEDLE;
        if let Some(i) = strings::index_of(self.cwd.as_bytes(), needle) {
            bun_core::pretty!(
                "<d>.{s}{s} @{f}<r>\n",
                BStr::new(SEP_STR.as_bytes()),
                BStr::new(strings::without_trailing_slash(
                    &self.cwd.as_bytes()[i + 1..]
                )),
                resolution.fmt(resolution_buf, PathSep::Posix),
            );
        } else {
            bun_core::pretty!(
                "<d>{s} @{f}<r>\n",
                BStr::new(strings::without_trailing_slash(self.cwd.as_bytes())),
                resolution.fmt(resolution_buf, PathSep::Posix),
            );
        }

        for (script_index, maybe_script) in self.items.iter().enumerate() {
            if let Some(script) = maybe_script {
                let name = LockfileScripts::NAMES[script_index];
                match format_type {
                    PrintFormat::Completed => bun_core::pretty!(
                        " <green>✓<r> [{s}]<d>:<r> <cyan>{s}<r>\n",
                        BStr::new(name),
                        BStr::new(script),
                    ),
                    PrintFormat::Untrusted => bun_core::pretty!(
                        " <yellow>»<r> [{s}]<d>:<r> <cyan>{s}<r>\n",
                        BStr::new(name),
                        BStr::new(script),
                    ),
                    PrintFormat::Info => bun_core::pretty!(
                        " [{s}]<d>:<r> <cyan>{s}<r>\n",
                        BStr::new(name),
                        BStr::new(script),
                    ),
                }
            }
        }
    }

    pub fn first(&self) -> &[u8] {
        debug_assert!(self.items[self.first_index as usize].is_some());
        self.items[self.first_index as usize].as_ref().unwrap()
    }

    // No manual deinit: `Box<[u8]>` fields drop automatically.

    pub(crate) fn append_to_lockfile(&self, lockfile: &mut Lockfile) {
        for (i, maybe_script) in self.items.iter().enumerate() {
            if let Some(script) = maybe_script {
                bun_output::scoped_log!(
                    Lockfile,
                    "enqueue({}, {}) in {}",
                    "prepare",
                    BStr::new(&self.package_name),
                    BStr::new(self.cwd.as_bytes()),
                );
                lockfile
                    .scripts
                    .hook_mut(i)
                    .push(script.to_vec().into_boxed_slice());
            }
        }
    }
}
