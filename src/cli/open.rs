use core::fmt::Write as _;
use std::io::Write as _;

use bun_core::{Global, Output};
use bun_dotenv as dot_env;
use bun_paths::{self, PathBuffer, MAX_PATH_BYTES};
use bun_resolver::fs as Fs;
use bun_str::{strings, ZStr};
use bun_which::which;

// ──────────────────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
pub const OPENER: &[u8] = b"/usr/bin/open";
#[cfg(windows)]
pub const OPENER: &[u8] = b"start";
#[cfg(not(any(target_os = "macos", windows)))]
pub const OPENER: &[u8] = b"xdg-open";

fn fallback(url: &[u8]) {
    Output::prettyln(format_args!("-> {}", bstr::BStr::new(url)));
    Output::flush();
}

pub fn open_url(url: &ZStr) {
    #[cfg(target_os = "wasi")]
    {
        return fallback(url.as_bytes());
    }

    // TODO(port): ZStr literals — Zig used [:0]const u8 array; using &[u8] here and
    // relying on spawn_sync to NUL-terminate as needed.
    #[cfg(target_os = "android")]
    let am_args: [&[u8]; 6] = [
        b"/system/bin/am",
        b"start",
        b"-a",
        b"android.intent.action.VIEW",
        b"-d",
        url.as_bytes(),
    ];
    let two_args: [&[u8]; 2] = [OPENER, url.as_bytes()];

    #[cfg(target_os = "android")]
    let args_buf: &[&[u8]] = &am_args;
    #[cfg(not(target_os = "android"))]
    let args_buf: &[&[u8]] = &two_args;

    'maybe_fallback: {
        // TODO(port): exact crate path for spawn_sync (src/runtime/api/bun/process.zig)
        let spawn_result = match bun_runtime::process::spawn_sync(&bun_runtime::process::SpawnOptions {
            argv: args_buf,
            envp: None,
            stderr: bun_runtime::process::Stdio::Inherit,
            stdout: bun_runtime::process::Stdio::Inherit,
            stdin: bun_runtime::process::Stdio::Inherit,
            #[cfg(windows)]
            windows: bun_runtime::process::WindowsOptions {
                loop_: bun_jsc::EventLoopHandle::init(bun_jsc::MiniEventLoop::init_global(None, None)),
            },
            ..Default::default()
        }) {
            Ok(r) => r,
            Err(_) => break 'maybe_fallback,
        };

        match spawn_result {
            // don't fallback:
            bun_sys::Result::Ok(result) => {
                if result.is_ok() {
                    return;
                }
            }
            bun_sys::Result::Err(_) => {}
        }
    }

    fallback(url.as_bytes());
}

// ──────────────────────────────────────────────────────────────────────────

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Hash, strum::IntoStaticStr, enum_map::Enum)]
#[strum(serialize_all = "snake_case")] // match Zig @tagName: .vscode → "vscode"
pub enum Editor {
    None,
    Sublime,
    Vscode,
    Atom,
    Textmate,
    Intellij,
    Webstorm,
    Vim,
    Neovim,
    Emacs,
    Other,
}

// PORT NOTE: Zig's `std.EnumMap(Editor, string)` / `std.EnumMap(Editor, []const [:0]const u8)`
// were comptime-initialized sparse maps. `bin_name` ported per PORTING.md as
// `enum_map::EnumMap<E, Option<V>>`; `bin_path` kept as a match-fn because of `#[cfg]` gating.

static NAME_MAP: phf::Map<&'static [u8], Editor> = phf::phf_map! {
    b"sublime" => Editor::Sublime,
    b"subl" => Editor::Sublime,
    b"vscode" => Editor::Vscode,
    b"code" => Editor::Vscode,
    b"textmate" => Editor::Textmate,
    b"mate" => Editor::Textmate,
    b"atom" => Editor::Atom,
    b"idea" => Editor::Intellij,
    b"webstorm" => Editor::Webstorm,
    b"nvim" => Editor::Neovim,
    b"neovim" => Editor::Neovim,
    b"vim" => Editor::Vim,
    b"vi" => Editor::Vim,
    b"emacs" => Editor::Emacs,
};

impl Editor {
    pub fn by_name(name: &[u8]) -> Option<Editor> {
        if let Some(i) = strings::index_of_char(name, b' ') {
            return NAME_MAP.get(&name[0..i as usize]).copied();
        }
        NAME_MAP.get(name).copied()
    }

    pub fn detect(env: &mut dot_env::Loader) -> Option<Editor> {
        const VARS: [&[u8]; 2] = [b"EDITOR", b"VISUAL"];
        for name in VARS {
            if let Some(value) = env.get(name) {
                let basename = bun_paths::basename(value);
                if let Some(editor) = Self::by_name(basename) {
                    return Some(editor);
                }
            }
        }
        None
    }

    pub fn by_path<'a>(
        env: &mut dot_env::Loader,
        buf: &'a mut PathBuffer,
        cwd: &[u8],
        out: &mut &'a [u8],
    ) -> Option<Editor> {
        let path_env = env.get(b"PATH")?;

        for &editor in &DEFAULT_PREFERENCE_LIST {
            if let Some(path) = BIN_NAME[editor] {
                if let Some(bin) = which(buf, path_env, cwd, path) {
                    *out = bin.as_bytes();
                    return Some(editor);
                }
            }
        }

        None
    }

    pub fn by_path_for_editor<'a>(
        env: &mut dot_env::Loader,
        editor: Editor,
        buf: &'a mut PathBuffer,
        cwd: &[u8],
        out: &mut &'a [u8],
    ) -> bool {
        let Some(path_env) = env.get(b"PATH") else {
            return false;
        };

        if let Some(path) = BIN_NAME[editor] {
            if !path.is_empty() {
                if let Some(bin) = which(buf, path_env, cwd, path) {
                    *out = bin.as_bytes();
                    return true;
                }
            }
        }

        false
    }

    pub fn by_fallback_path_for_editor(editor: Editor, out: Option<&mut &'static [u8]>) -> bool {
        if let Some(paths) = bin_path(editor) {
            for path in paths {
                // TODO(port): replace std.fs.cwd().openFile with bun_sys equivalent
                // (bun_sys::File::open / bun_sys::access). Zig used std.fs directly here.
                match bun_sys::File::open_at(bun_sys::Fd::cwd(), path, bun_sys::O::RDONLY, 0) {
                    bun_sys::Result::Ok(opened) => {
                        opened.close();
                        if let Some(out) = out {
                            *out = path.as_bytes();
                        }
                        return true;
                    }
                    bun_sys::Result::Err(_) => {}
                }
            }
        }

        false
    }

    pub fn by_fallback<'a>(
        env: &mut dot_env::Loader,
        buf: &'a mut PathBuffer,
        cwd: &[u8],
        out: &mut &'a [u8],
    ) -> Option<Editor> {
        for &editor in &DEFAULT_PREFERENCE_LIST {
            if Self::by_path_for_editor(env, editor, buf, cwd, out) {
                return Some(editor);
            }

            // PORT NOTE: reshaped for borrowck — by_fallback_path_for_editor writes a
            // 'static slice; we widen `out` to accept it via a temporary.
            // TODO(port): lifetime — `out` may need to be `&mut &[u8]` with caller-chosen lifetime.
            let mut static_out: &'static [u8] = b"";
            if Self::by_fallback_path_for_editor(editor, Some(&mut static_out)) {
                *out = static_out;
                return Some(editor);
            }
        }

        None
    }

    pub fn is_jet_brains(self) -> bool {
        matches!(self, Editor::Intellij | Editor::Webstorm)
    }

    pub fn open(
        self,
        binary: &[u8],
        file: &[u8],
        line: Option<&[u8]>,
        column: Option<&[u8]>,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let mut spawned = Box::new(SpawnedEditorContext::default());
        // errdefer default_allocator.destroy(spawned) — handled by Box Drop on `?`.

        let mut cursor = std::io::Cursor::new(&mut spawned.file_path_buf[..]);
        // PORT NOTE: `args_buf` entries borrow both static strings and `file_path_buf`
        // (self-referential once boxed). Kept as raw byte-slice ptrs; reconstructed
        // as slices when handed to the child process.
        let mut i: usize = 0;

        macro_rules! push_arg {
            ($s:expr) => {{
                spawned.buf[i] = ($s.as_ptr(), $s.len());
                i += 1;
            }};
        }

        if matches!(self, Editor::Vim | Editor::Emacs | Editor::Neovim) {
            push_arg!(OPENER);
            push_arg!(binary);

            #[cfg(target_os = "macos")]
            {
                push_arg!(b"--args");
            }
        }

        push_arg!(binary);

        if self == Editor::Vscode && line.is_some() && !line.unwrap().is_empty() {
            push_arg!(b"--goto");
        }

        match self {
            Editor::Sublime | Editor::Atom | Editor::Vscode | Editor::Webstorm | Editor::Intellij => {
                cursor.write_all(file).map_err(|_| bun_core::err!("WriteFailed"))?;
                if let Some(line_) = line {
                    if !line_.is_empty() {
                        write!(cursor, ":{}", bstr::BStr::new(line_))
                            .map_err(|_| bun_core::err!("WriteFailed"))?;

                        if !self.is_jet_brains() {
                            if let Some(col) = column {
                                if !col.is_empty() {
                                    write!(cursor, ":{}", bstr::BStr::new(col))
                                        .map_err(|_| bun_core::err!("WriteFailed"))?;
                                }
                            }
                        }
                    }
                }
                let pos = usize::try_from(cursor.position()).unwrap();
                if pos > 0 {
                    let written = &spawned.file_path_buf[0..pos];
                    push_arg!(written);
                }
            }
            Editor::Textmate => {
                cursor.write_all(file).map_err(|_| bun_core::err!("WriteFailed"))?;
                let file_path_len = usize::try_from(cursor.position()).unwrap();

                if let Some(line_) = line {
                    if !line_.is_empty() {
                        push_arg!(b"--line");

                        write!(cursor, "{}", bstr::BStr::new(line_))
                            .map_err(|_| bun_core::err!("WriteFailed"))?;

                        if let Some(col) = column {
                            if !col.is_empty() {
                                write!(cursor, ":{}", bstr::BStr::new(col))
                                    .map_err(|_| bun_core::err!("WriteFailed"))?;
                            }
                        }

                        let pos = usize::try_from(cursor.position()).unwrap();
                        let line_column = &spawned.file_path_buf[file_path_len..pos];
                        if !line_column.is_empty() {
                            push_arg!(line_column);
                        }
                    }
                }

                let pos = usize::try_from(cursor.position()).unwrap();
                if pos > 0 {
                    let file_path = &spawned.file_path_buf[0..file_path_len];
                    push_arg!(file_path);
                }
            }
            _ => {
                if !file.is_empty() {
                    cursor.write_all(file).map_err(|_| bun_core::err!("WriteFailed"))?;
                    let pos = usize::try_from(cursor.position()).unwrap();
                    let file_path = &spawned.file_path_buf[0..pos];
                    push_arg!(file_path);
                }
            }
        }

        spawned.argc = i;
        // TODO(port): std.process.Child is banned (PORTING.md: no std::process).
        // Zig stored `std.process.Child.init(args_buf[0..i], default_allocator)` here and
        // spawned a detached std.Thread to run it. Phase B should replace with
        // bun_runtime::process::spawn (async) or a bun_threading worker that owns
        // SpawnedEditorContext and calls bun.spawnSync.
        let spawned_ptr = Box::into_raw(spawned);
        // TODO(port): std.Thread.spawn → bun_threading::spawn_detached
        bun_threading::spawn_detached(move || auto_close(spawned_ptr))
            .map_err(|_| bun_core::err!("ThreadSpawnFailed"))?;
        Ok(())
    }
}

pub const DEFAULT_PREFERENCE_LIST: [Editor; 8] = [
    Editor::Vscode,
    Editor::Sublime,
    Editor::Atom,
    Editor::Neovim,
    Editor::Webstorm,
    Editor::Intellij,
    Editor::Textmate,
    Editor::Vim,
];

// PORT NOTE: was `pub const bin_name: std.EnumMap(Editor, string)` built in a comptime block.
pub static BIN_NAME: once_cell::sync::Lazy<enum_map::EnumMap<Editor, Option<&'static [u8]>>> =
    once_cell::sync::Lazy::new(|| {
        enum_map::enum_map! {
            Editor::Sublime => Some(&b"subl"[..]),
            Editor::Vscode => Some(&b"code"[..]),
            Editor::Atom => Some(&b"atom"[..]),
            Editor::Textmate => Some(&b"mate"[..]),
            Editor::Intellij => Some(&b"idea"[..]),
            Editor::Webstorm => Some(&b"webstorm"[..]),
            Editor::Vim => Some(&b"vim"[..]),
            Editor::Neovim => Some(&b"nvim"[..]),
            Editor::Emacs => Some(&b"emacs"[..]),
            Editor::Other => Some(&b""[..]),
            Editor::None => None,
        }
    });

// PORT NOTE: was `pub const bin_path: std.EnumMap(Editor, []const [:0]const u8)`.
// TODO(port): EnumMap — kept as match-fn because entries are `#[cfg(target_os)]`-gated
// and `enum_map!{}` cannot host per-arm `#[cfg]` attrs cleanly.
pub fn bin_path(editor: Editor) -> Option<&'static [&'static ZStr]> {
    #[cfg(target_os = "macos")]
    {
        // TODO(port): ZStr literal constructor (bun_str::zstr!("..."))
        match editor {
            Editor::Vscode => Some(&[
                ZStr::from_static(b"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code\0"),
                ZStr::from_static(b"/Applications/VSCodium.app/Contents/Resources/app/bin/code\0"),
            ]),
            Editor::Atom => Some(&[
                ZStr::from_static(b"/Applications/Atom.app/Contents/Resources/app/atom.sh\0"),
            ]),
            Editor::Sublime => Some(&[
                ZStr::from_static(b"/Applications/Sublime Text 4.app/Contents/SharedSupport/bin/subl\0"),
                ZStr::from_static(b"/Applications/Sublime Text 3.app/Contents/SharedSupport/bin/subl\0"),
                ZStr::from_static(b"/Applications/Sublime Text 2.app/Contents/SharedSupport/bin/subl\0"),
                ZStr::from_static(b"/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl\0"),
            ]),
            _ => None,
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = editor;
        None
    }
}

// PORT NOTE: `buf` stores (ptr, len) pairs because entries point into `file_path_buf`
// (self-referential) as well as caller-provided/static slices. Reconstructed as slices
// in `auto_close`.
pub struct SpawnedEditorContext {
    pub file_path_buf: [u8; 1024 + MAX_PATH_BYTES],
    pub buf: [(*const u8, usize); 10],
    pub argc: usize,
    // TODO(port): was `std.process.Child` — replace with bun spawn handle in Phase B.
}

impl Default for SpawnedEditorContext {
    fn default() -> Self {
        Self {
            file_path_buf: [0; 1024 + MAX_PATH_BYTES],
            buf: [(core::ptr::null(), 0); 10],
            argc: 0,
        }
    }
}

fn auto_close(spawned: *mut SpawnedEditorContext) {
    // SAFETY: `spawned` came from Box::into_raw in `Editor::open`; this thread is the
    // sole owner and reconstitutes the Box to drop it at scope exit.
    let spawned = unsafe { Box::from_raw(spawned) };

    Global::set_thread_name("Open Editor");

    // Reconstruct argv slices from stored (ptr, len).
    let mut argv: [&[u8]; 10] = [b""; 10];
    for j in 0..spawned.argc {
        let (p, l) = spawned.buf[j];
        // SAFETY: pointers reference either 'static data or `spawned.file_path_buf`,
        // both of which outlive this function.
        argv[j] = unsafe { core::slice::from_raw_parts(p, l) };
    }

    // TODO(port): Zig called `child_process.spawn()` then `.wait()` via std.process.Child.
    // Replace with bun_runtime::process::spawn_sync once available from a non-JS thread.
    let _ = bun_runtime::process::spawn_sync(&bun_runtime::process::SpawnOptions {
        argv: &argv[0..spawned.argc],
        envp: None,
        stderr: bun_runtime::process::Stdio::Inherit,
        stdout: bun_runtime::process::Stdio::Inherit,
        stdin: bun_runtime::process::Stdio::Inherit,
        ..Default::default()
    });
}

// ──────────────────────────────────────────────────────────────────────────

pub struct EditorContext {
    pub editor: Option<Editor>,
    // PORT NOTE: `name`/`path` are never freed in Zig; `path` is backed by
    // `Fs.FileSystem.instance.dirname_store` (process-lifetime arena) or aliases `name`.
    pub name: &'static [u8],
    pub path: &'static [u8],
}

impl Default for EditorContext {
    fn default() -> Self {
        Self {
            editor: None,
            name: b"",
            path: b"",
        }
    }
}

impl EditorContext {
    pub fn open_in_editor(
        &mut self,
        editor_: Editor,
        blob: &[u8],
        id: &[u8],
        tmpdir: bun_sys::Fd,
        line: &[u8],
        column: &[u8],
    ) {
        if let Err(err) = Self::_open_in_editor(self.path, editor_, blob, id, tmpdir, line, column) {
            if editor_ != Editor::Other {
                Output::pretty_errorln(format_args!(
                    "Error {} opening in {}",
                    err.name(),
                    <&'static str>::from(editor_),
                ));
            }
            self.editor = Some(Editor::None);
        }
    }

    fn _open_in_editor(
        path: &[u8],
        editor_: Editor,
        blob: &[u8],
        id: &[u8],
        tmpdir: bun_sys::Fd,
        line: &[u8],
        column: &[u8],
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let mut basename_buf = [0u8; 512];
        let mut basename = bun_paths::basename(id);
        if strings::ends_with(basename, b".bun") && basename.len() < 499 {
            basename_buf[..basename.len()].copy_from_slice(basename);
            basename_buf[basename.len()..basename.len() + 3].copy_from_slice(b".js");
            basename = &basename_buf[0..basename.len() + 3];
        }

        // TODO(port): Zig used std.fs.Dir.writeFile / openFile. Map to bun_sys::File.
        bun_sys::File::write_file(tmpdir, basename, blob)
            .into_result()
            .map_err(Into::into)?;

        let opened = bun_sys::File::open_at(tmpdir, basename, bun_sys::O::RDONLY, 0)
            .into_result()
            .map_err(Into::into)?;
        let _close = scopeguard::guard((), |_| opened.close());

        let mut path_buf = PathBuffer::uninit();
        let resolved = bun_sys::get_fd_path(opened.handle(), &mut path_buf)
            .into_result()
            .map_err(Into::into)?;

        editor_.open(path, resolved, Some(line), Some(column))
    }

    pub fn auto_detect_editor(&mut self, env: &mut dot_env::Loader) {
        if self.editor.is_none() {
            self.detect_editor(env);
        }
    }

    pub fn detect_editor(&mut self, env: &mut dot_env::Loader) {
        let mut buf = PathBuffer::uninit();
        let mut out: &[u8] = b"";

        // first: choose from user preference
        if !self.name.is_empty() {
            // /usr/bin/vim
            if bun_paths::is_absolute(self.name) {
                self.editor = Some(
                    Editor::by_name(bun_paths::basename(self.name)).unwrap_or(Editor::Other),
                );
                self.path = self.name;
                return;
            }

            // "vscode"
            if let Some(editor_) = Editor::by_name(bun_paths::basename(self.name)) {
                if Editor::by_path_for_editor(
                    env,
                    editor_,
                    &mut buf,
                    Fs::FileSystem::instance().top_level_dir,
                    &mut out,
                ) {
                    self.editor = Some(editor_);
                    self.path = Fs::FileSystem::instance()
                        .dirname_store
                        .append(out)
                        .expect("unreachable");
                    return;
                }

                // not in path, try common ones
                let mut static_out: &'static [u8] = b"";
                if Editor::by_fallback_path_for_editor(editor_, Some(&mut static_out)) {
                    self.editor = Some(editor_);
                    self.path = Fs::FileSystem::instance()
                        .dirname_store
                        .append(static_out)
                        .expect("unreachable");
                    return;
                }
            }
        }

        // EDITOR=code
        if let Some(editor_) = Editor::detect(env) {
            if Editor::by_path_for_editor(
                env,
                editor_,
                &mut buf,
                Fs::FileSystem::instance().top_level_dir,
                &mut out,
            ) {
                self.editor = Some(editor_);
                self.path = Fs::FileSystem::instance()
                    .dirname_store
                    .append(out)
                    .expect("unreachable");
                return;
            }

            // not in path, try common ones
            let mut static_out: &'static [u8] = b"";
            if Editor::by_fallback_path_for_editor(editor_, Some(&mut static_out)) {
                self.editor = Some(editor_);
                self.path = Fs::FileSystem::instance()
                    .dirname_store
                    .append(static_out)
                    .expect("unreachable");
                return;
            }
        }

        // Don't know, so we will just guess based on what exists
        if let Some(editor_) = Editor::by_fallback(
            env,
            &mut buf,
            Fs::FileSystem::instance().top_level_dir,
            &mut out,
        ) {
            self.editor = Some(editor_);
            self.path = Fs::FileSystem::instance()
                .dirname_store
                .append(out)
                .expect("unreachable");
            return;
        }

        self.editor = Some(Editor::None);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/open.zig (450 lines)
//   confidence: medium
//   todos:      13
//   notes:      std.process.Child + std.Thread replaced with stubs; SpawnedEditorContext made self-ref-safe via (ptr,len); std.fs calls mapped to bun_sys with guessed signatures; BIN_NAME wrapped in Lazy (enum_map! is non-const)
// ──────────────────────────────────────────────────────────────────────────
