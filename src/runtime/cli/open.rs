use std::io::Write as _;

use bun_core::Global;
use bun_core::{ZStr, strings};
use bun_dotenv as dot_env;
use bun_paths::{self, PathBuffer};
use bun_resolver::fs as Fs;
use bun_which::which;

use crate::api::bun::process::sync;

// ──────────────────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
const OPENER: &[u8] = b"/usr/bin/open";
#[cfg(windows)]
const OPENER: &[u8] = b"start";
#[cfg(not(any(target_os = "macos", windows)))]
const OPENER: &[u8] = b"xdg-open";

// ──────────────────────────────────────────────────────────────────────────

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Hash, strum::IntoStaticStr, enum_map::Enum)]
#[strum(serialize_all = "snake_case")] // Vscode → "vscode"
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

// Note: `bin_name` is an `enum_map::EnumMap<E, Option<V>>` (sparse map);
// `bin_path` is a match-fn because of `#[cfg]` gating.

bun_core::comptime_string_map! {
    static NAME_MAP: Editor = {
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
}

impl Editor {
    pub(crate) fn by_name(name: &[u8]) -> Option<Editor> {
        if let Some(i) = strings::index_of_char(name, b' ') {
            return NAME_MAP.get(&name[0..i as usize]).copied();
        }
        NAME_MAP.get(name).copied()
    }

    pub(crate) fn detect(env: &mut dot_env::Loader) -> Option<Editor> {
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

    /// On a hit, the binary path is `buf[..len]`.
    pub(crate) fn by_path_for_editor(
        env: &mut dot_env::Loader,
        editor: Editor,
        buf: &mut PathBuffer,
        cwd: &[u8],
    ) -> Option<usize> {
        let path_env = env.get(b"PATH")?;

        if let Some(bin_name) = BIN_NAME[editor] {
            if !bin_name.is_empty() {
                if let Some(bin) = which(buf, path_env, cwd, bin_name) {
                    return Some(bin.len());
                }
            }
        }

        None
    }

    pub(crate) fn by_fallback_path_for_editor(
        editor: Editor,
        out: Option<&mut &'static [u8]>,
    ) -> bool {
        if let Some(paths) = bin_path(editor) {
            for path in paths {
                match bun_sys::File::open_at(bun_sys::Fd::cwd(), path, bun_sys::O::RDONLY, 0) {
                    bun_sys::Result::Ok(opened) => {
                        let _ = opened.close(); // close error is non-actionable
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

    pub(crate) fn by_fallback<'a>(
        env: &mut dot_env::Loader,
        buf: &'a mut PathBuffer,
        cwd: &[u8],
    ) -> Option<(Editor, &'a [u8])> {
        for &editor in &DEFAULT_PREFERENCE_LIST {
            if let Some(len) = Self::by_path_for_editor(env, editor, buf, cwd) {
                return Some((editor, &buf[..len]));
            }

            let mut static_out: &'static [u8] = b"";
            if Self::by_fallback_path_for_editor(editor, Some(&mut static_out)) {
                return Some((editor, static_out));
            }
        }

        None
    }

    pub(crate) fn is_jet_brains(self) -> bool {
        matches!(self, Editor::Intellij | Editor::Webstorm)
    }

    pub(crate) fn open(
        self,
        binary: &[u8],
        file: &[u8],
        line: Option<&[u8]>,
        column: Option<&[u8]>,
    ) -> crate::Result<()> {
        let mut argv: Vec<Box<[u8]>> = Vec::with_capacity(10);
        macro_rules! push_arg {
            ($s:expr) => {{
                argv.push(Box::<[u8]>::from(&$s[..]));
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
            Editor::Sublime
            | Editor::Atom
            | Editor::Vscode
            | Editor::Webstorm
            | Editor::Intellij => {
                let mut file_path: Vec<u8> = Vec::with_capacity(file.len() + 16);
                file_path.extend_from_slice(file);
                if let Some(line_) = line {
                    if !line_.is_empty() {
                        write!(file_path, ":{}", bstr::BStr::new(line_))
                            .map_err(|_| crate::Error::WriteFailed)?;

                        if !self.is_jet_brains() {
                            if let Some(col) = column {
                                if !col.is_empty() {
                                    write!(file_path, ":{}", bstr::BStr::new(col))
                                        .map_err(|_| crate::Error::WriteFailed)?;
                                }
                            }
                        }
                    }
                }
                if !file_path.is_empty() {
                    argv.push(file_path.into_boxed_slice());
                }
            }
            Editor::Textmate => {
                let mut line_column: Vec<u8> = Vec::new();
                if let Some(line_) = line {
                    if !line_.is_empty() {
                        push_arg!(b"--line");

                        write!(line_column, "{}", bstr::BStr::new(line_))
                            .map_err(|_| crate::Error::WriteFailed)?;

                        if let Some(col) = column {
                            if !col.is_empty() {
                                write!(line_column, ":{}", bstr::BStr::new(col))
                                    .map_err(|_| crate::Error::WriteFailed)?;
                            }
                        }
                    }
                }

                let has_line_column = !line_column.is_empty();
                if has_line_column {
                    argv.push(line_column.into_boxed_slice());
                }

                if !file.is_empty() || has_line_column {
                    push_arg!(file);
                }
            }
            _ => {
                if !file.is_empty() {
                    push_arg!(file);
                }
            }
        }

        // bun_threading has no detached-spawn helper; std::thread::spawn is used
        // and the JoinHandle is dropped, detaching the thread.
        std::thread::Builder::new()
            .spawn(move || auto_close(argv))
            .map_err(|_| crate::Error::ThreadSpawnFailed)?;
        Ok(())
    }
}

const DEFAULT_PREFERENCE_LIST: [Editor; 8] = [
    Editor::Vscode,
    Editor::Sublime,
    Editor::Atom,
    Editor::Neovim,
    Editor::Webstorm,
    Editor::Intellij,
    Editor::Textmate,
    Editor::Vim,
];

static BIN_NAME: std::sync::LazyLock<enum_map::EnumMap<Editor, Option<&'static [u8]>>> =
    std::sync::LazyLock::new(|| {
        enum_map::EnumMap::from_fn(|k| match k {
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
        })
    });

fn bin_path(editor: Editor) -> Option<&'static [&'static ZStr]> {
    #[cfg(target_os = "macos")]
    {
        // `const { &[...] }` forces const-promotion so the array lives in
        // `'static` storage (otherwise `&[..]` borrows a stack temporary).
        match editor {
            Editor::Vscode => Some(
                const {
                    &[
                ZStr::from_static(b"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code\0"),
                ZStr::from_static(b"/Applications/VSCodium.app/Contents/Resources/app/bin/code\0"),
            ]
                },
            ),
            Editor::Atom => Some(
                const {
                    &[ZStr::from_static(
                        b"/Applications/Atom.app/Contents/Resources/app/atom.sh\0",
                    )]
                },
            ),
            Editor::Sublime => {
                Some(
                    const {
                        &[
                ZStr::from_static(b"/Applications/Sublime Text 4.app/Contents/SharedSupport/bin/subl\0"),
                ZStr::from_static(b"/Applications/Sublime Text 3.app/Contents/SharedSupport/bin/subl\0"),
                ZStr::from_static(b"/Applications/Sublime Text 2.app/Contents/SharedSupport/bin/subl\0"),
                ZStr::from_static(b"/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl\0"),
            ]
                    },
                )
            }
            _ => None,
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = editor;
        None
    }
}

fn auto_close(argv: Vec<Box<[u8]>>) {
    Global::set_thread_name(bun_core::zstr!("Open Editor"));

    // FIXME(windows-leak): the sync::spawn path
    // requires a `WindowsOptions.loop_`; `MiniEventLoop::init_global` heap-allocates a
    // MiniEventLoop + uv_loop_t into a thread-local that is NEVER torn down. Because this
    // runs on a fresh detached std::thread per `Editor::open()` call, every editor-open on
    // Windows leaks one MiniEventLoop + uv_loop_t (+ DotEnv Loader/Map if env was null).
    // Proper fix needs either (a) a MiniEventLoop teardown helper (none exists today), or
    // (b) plumbing the caller's existing EventLoopHandle through `Editor::open`
    // (signature change to Editor::open + callers). Both are out-of-scope for this file.
    let _ = sync::spawn(&sync::Options {
        argv,
        envp: None,
        stderr: sync::SyncStdio::Inherit,
        stdout: sync::SyncStdio::Inherit,
        stdin: sync::SyncStdio::Inherit,
        #[cfg(windows)]
        windows: crate::api::bun::process::WindowsOptions {
            loop_: bun_jsc::EventLoopHandle::init_mini(bun_event_loop::MiniEventLoop::init_global(
                None, None,
            )),
            ..Default::default()
        },
        ..Default::default()
    });
}

// ──────────────────────────────────────────────────────────────────────────

pub struct EditorContext {
    pub(crate) editor: Option<Editor>,
    // Note: `name`/`path` are never freed; `path` is backed by
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
    /// `detect_editor` records `Editor::None` when nothing was found so the
    /// search is not repeated; to callers that means "no editor".
    pub(crate) fn found(&self) -> Option<Editor> {
        self.editor.filter(|e| *e != Editor::None)
    }

    pub(crate) fn auto_detect_editor(&mut self, env: &mut dot_env::Loader) {
        if self.editor.is_none() {
            self.detect_editor(env);
        }
    }

    pub(crate) fn detect_editor(&mut self, env: &mut dot_env::Loader) {
        let mut buf = PathBuffer::uninit();
        let top_level_dir = Fs::FileSystem::get().top_level_dir;
        let dirname_store = Fs::FileSystem::get().dirname_store;

        // first: choose from user preference
        if !self.name.is_empty() {
            // /usr/bin/vim
            if bun_paths::is_absolute(self.name) {
                self.editor =
                    Some(Editor::by_name(bun_paths::basename(self.name)).unwrap_or(Editor::Other));
                self.path = self.name;
                return;
            }

            // "vscode"
            if let Some(editor_) = Editor::by_name(bun_paths::basename(self.name)) {
                if let Some(len) = Editor::by_path_for_editor(env, editor_, &mut buf, top_level_dir)
                {
                    self.editor = Some(editor_);
                    self.path = dirname_store
                        .append_slice(&buf[..len])
                        .expect("unreachable");
                    return;
                }

                // not in path, try common ones
                let mut static_out: &'static [u8] = b"";
                if Editor::by_fallback_path_for_editor(editor_, Some(&mut static_out)) {
                    self.editor = Some(editor_);
                    self.path = dirname_store.append_slice(static_out).expect("unreachable");
                    return;
                }
            }
        }

        // EDITOR=code
        if let Some(editor_) = Editor::detect(env) {
            if let Some(len) = Editor::by_path_for_editor(env, editor_, &mut buf, top_level_dir) {
                self.editor = Some(editor_);
                self.path = dirname_store
                    .append_slice(&buf[..len])
                    .expect("unreachable");
                return;
            }

            // not in path, try common ones
            let mut static_out: &'static [u8] = b"";
            if Editor::by_fallback_path_for_editor(editor_, Some(&mut static_out)) {
                self.editor = Some(editor_);
                self.path = dirname_store.append_slice(static_out).expect("unreachable");
                return;
            }
        }

        // Don't know, so we will just guess based on what exists
        if let Some((editor_, out)) = Editor::by_fallback(env, &mut buf, top_level_dir) {
            self.editor = Some(editor_);
            self.path = dirname_store.append_slice(out).expect("unreachable");
            return;
        }

        self.editor = Some(Editor::None);
    }
}
