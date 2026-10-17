use bun_core::pretty_errorln;
use bun_core::strings;
use bun_core::{Global, Output, env_var};
#[cfg(not(windows))]
use bun_core::{note, print_errorln};
#[cfg(not(windows))]
use bun_paths::{platform, resolve_path};
use bun_sys::{self, File};

use crate::shell_completions::{Shell, ShellCompletionsExt as _};

pub(crate) struct InstallCompletionsCommand;

impl InstallCompletionsCommand {
    #[cfg(not(windows))]
    const BUNX_NAME: &'static str = if bun_core::env::IS_DEBUG {
        "bunx-debug"
    } else {
        "bunx"
    };

    #[cfg(not(windows))]
    fn install_bunx_symlink(cwd: &[u8]) -> Result<(), crate::Error> {
        let mut buf = bun_paths::path_buffer_pool::get();

        // don't install it if it's already there
        if bun_which::which(
            &mut buf,
            env_var::PATH.get().unwrap_or(cwd),
            cwd,
            Self::BUNX_NAME.as_bytes(),
        )
        .is_some()
        {
            return Ok(());
        }

        // first try installing the symlink into the same directory as the bun executable
        let exe = bun_core::self_exe_path()?;
        let mut link_buf = bun_paths::path_buffer_pool::get();
        let link_path = buf_print_z(
            &mut link_buf,
            format_args!(
                "{}/{}",
                bstr::BStr::new(bun_core::dirname(exe).expect("exe has dirname")),
                Self::BUNX_NAME
            ),
        );
        if bun_sys::symlink(exe, link_path).is_ok() {
            return Ok(());
        }

        for (dir, bin_dir) in [
            (env_var::BUN_INSTALL.get(), "bin"),
            (env_var::HOME.get(), ".bun/bin"),
            (env_var::HOME.get(), ".local/bin"),
        ] {
            let Some(dir) = dir else { continue };
            let link_path = buf_print_z(
                &mut link_buf,
                format_args!("{}/{}/{}", bstr::BStr::new(dir), bin_dir, Self::BUNX_NAME),
            );
            if bun_sys::symlink(exe, link_path).is_ok() {
                return Ok(());
            }
        }

        // otherwise...give up?
        Ok(())
    }

    /// fish makes `<config>/fish/completions` on demand. Without the parent (no fish) nothing is made.
    #[cfg(not(windows))]
    fn open_fish_user_completions(completions_dir: &[u8]) -> Option<bun_sys::Fd> {
        bun_sys::open_dir_absolute(completions_dir)
            .ok()
            .or_else(|| {
                bun_sys::mkdir(&bun_core::ZBox::from_bytes(completions_dir), 0o755).ok()?;
                bun_sys::open_dir_absolute(completions_dir).ok()
            })
    }

    #[cfg(windows)]
    fn install_bunx_symlink(_cwd: &[u8]) -> Result<(), crate::Error> {
        use bun_core::{WStr, w};
        use bun_sys::windows;

        // Symlinks are not always allowed: `bunx.exe` is a hardlink to `bun.exe`, recreated every time.
        let image_path: &[u16] = windows::exe_path_w();
        let last_sep =
            strings::last_index_of_char_t(image_path, u16::from(b'\\')).expect("unreachable");
        let image_dirname = &image_path[..last_sep + 1];

        let mut bunx_path_buf = bun_paths::w_path_buffer_pool::get();

        let cmd_suffix: &[u16] = if bun_core::env::IS_DEBUG {
            w!("bunx-debug.cmd")
        } else {
            w!("bunx.cmd")
        };
        let exe_suffix_z: &[u16] = if bun_core::env::IS_DEBUG {
            w!("bunx-debug.exe\0")
        } else {
            w!("bunx.exe\0")
        };

        let delete_path = strings::concat_buf_t::<u16>(
            &mut bunx_path_buf,
            &[&windows::NT_OBJECT_PREFIX, image_dirname, cmd_suffix],
        )?;
        let _ = windows::DeleteFileBun(delete_path, windows::DeleteFileOptions::default());

        let bunx_path_with_z = strings::concat_buf_t::<u16>(
            &mut bunx_path_buf,
            &[&windows::NT_OBJECT_PREFIX, image_dirname, exe_suffix_z],
        )?;
        let bunx_path = WStr::from_slice_with_nul(&bunx_path_with_z[..]);
        let _ = windows::DeleteFileBun(bunx_path.as_slice(), windows::DeleteFileOptions::default());

        if windows::CreateHardLinkW(bunx_path.as_ptr(), image_path.as_ptr(), None) == 0 {
            // if hard link fails, use a cmd script
            const SCRIPT: &[u8] = b"@%~dp0bun.exe x %*\n";

            let bunx_cmd = strings::concat_buf_t::<u16>(
                &mut bunx_path_buf,
                &[&windows::NT_OBJECT_PREFIX, image_dirname, cmd_suffix],
            )?;
            let file = File::create_w(bun_sys::Fd::cwd(), bunx_cmd)?;
            file.write_all(SCRIPT)?;
        }
        Ok(())
    }

    #[cfg(windows)]
    fn install_uninstaller_windows() -> Result<(), crate::Error> {
        use bun_core::w;
        use bun_sys::windows;

        // Only for an exe at `bun\bin\<whatever>.exe`, which `install.ps1` has probably installed.
        let image_path: &[u16] = windows::exe_path_w();
        let last_sep =
            strings::last_index_of_char_t(image_path, u16::from(b'\\')).expect("unreachable");
        let image_dirname = &image_path[..last_sep];

        if !image_dirname.ends_with(w!("bun\\bin")) {
            return Ok(());
        }

        const CONTENT: &[u8] = include_bytes!("uninstall.ps1");

        let mut bunx_path_buf = bun_paths::w_path_buffer_pool::get();
        let uninstaller_path = strings::concat_buf_t::<u16>(
            &mut bunx_path_buf,
            &[
                &windows::NT_OBJECT_PREFIX,
                &image_dirname[..image_dirname.len() - 3],
                w!("uninstall.ps1"),
            ],
        )?;

        let file = File::create_w(bun_sys::Fd::cwd(), uninstaller_path)?;
        file.write_all(CONTENT)?;
        Ok(())
    }

    fn print_powershell_completions_unsupported() {
        Output::err_generic(
            "PowerShell completions are not yet written for Bun.",
            format_args!(""),
        );
        Output::print_errorln("See https://github.com/oven-sh/bun/issues/8939");
    }

    fn write_and_exit(completions: &[u8]) -> ! {
        Output::stdout_is_the_result();
        let _ = Output::writer().write_all(completions);
        Global::exit(0);
    }

    pub(crate) fn exec() -> Result<(), crate::Error> {
        // Fail silently on auto-update.
        let fail_exit_code = u32::from(!env_var::IS_BUN_AUTO_UPDATE.get().unwrap_or(false));

        let mut cwd_buf = bun_paths::path_buffer_pool::get();

        let stdout = File::stdout();

        let shell = env_var::SHELL
            .platform_get()
            .map_or(Shell::Unknown, Shell::from_env);

        let cwd_len = match bun_sys::getcwd(&mut cwd_buf) {
            Ok(len) => len,
            Err(_) => {
                // don't fail on this if we don't actually need to
                if fail_exit_code == 1 && !bun_sys::isatty(stdout.handle) {
                    let completions = shell.completions();
                    if !completions.is_empty() {
                        Self::write_and_exit(completions);
                    }
                }

                pretty_errorln!("<r><red>error<r>: Could not get current working directory");
                Global::exit(fail_exit_code);
            }
        };
        let cwd: &[u8] = &cwd_buf[..cwd_len];

        let _ = Self::install_bunx_symlink(cwd);

        #[cfg(windows)]
        {
            let _ = Self::install_uninstaller_windows();
            Self::print_powershell_completions_unsupported();
            return Ok(());
        }

        #[cfg(not(windows))]
        {
            let filename: &[u8] = match shell {
                Shell::Unknown => {
                    Output::err_generic(
                        "Unknown or unsupported shell. Please set $SHELL to one of zsh, fish, or bash.",
                        format_args!(""),
                    );
                    note!("To manually output completions, run 'bun getcompletes'");
                    Global::exit(fail_exit_code);
                }
                Shell::Pwsh => {
                    Self::print_powershell_completions_unsupported();
                    Global::exit(fail_exit_code);
                }
                Shell::Fish => b"bun.fish",
                Shell::Zsh => b"_bun",
                Shell::Bash => b"bun.completion.bash",
            };

            if !env_var::IS_BUN_AUTO_UPDATE.get().unwrap_or(false)
                && !bun_sys::isatty(stdout.handle)
            {
                Self::write_and_exit(shell.completions());
            }

            let mut completions_dir: &[u8];
            let output_dir: bun_sys::Fd = 'found: {
                let argv = bun_core::argv();
                for (i, arg) in argv.iter().enumerate() {
                    if arg == b"completions" {
                        if argv.len() > i + 1 {
                            let input: &[u8] = argv.get(i + 1).expect("len checked").as_bytes();

                            if !bun_paths::is_absolute(input) {
                                completions_dir =
                                    resolve_path::join_abs::<platform::Auto>(cwd, input);
                            } else {
                                completions_dir = input;
                            }

                            if !bun_paths::is_absolute(completions_dir) {
                                pretty_errorln!(
                                    "<r><red>error:<r> Please pass an absolute path. {} is invalid",
                                    bstr::BStr::new(completions_dir),
                                );
                                Global::exit(fail_exit_code);
                            }

                            match bun_sys::open_dir_absolute(completions_dir) {
                                Ok(d) => break 'found d,
                                Err(err) => {
                                    pretty_errorln!(
                                        "<r><red>error:<r> accessing {} errored {}",
                                        bstr::BStr::new(completions_dir),
                                        bstr::BStr::new(err.name()),
                                    );
                                    Global::exit(fail_exit_code);
                                }
                            }
                        }

                        break;
                    }
                }

                match shell {
                    Shell::Fish => {
                        let (fish, config_fish): (&[u8], &[u8]) =
                            (b"./fish/completions", b"./.config/fish/completions");
                        for (base, dir, is_config) in [
                            (env_var::XDG_CONFIG_HOME.get(), fish, true),
                            (env_var::XDG_DATA_HOME.get(), fish, false),
                            (env_var::HOME.get(), config_fish, true),
                        ] {
                            let Some(base) = base else { continue };
                            completions_dir =
                                resolve_path::join_abs_string::<platform::Auto>(cwd, &[base, dir]);
                            let opened = if is_config {
                                Self::open_fish_user_completions(completions_dir)
                            } else {
                                bun_sys::open_dir_absolute(completions_dir).ok()
                            };
                            if let Some(d) = opened {
                                break 'found d;
                            }
                        }

                        #[cfg(target_os = "macos")]
                        {
                            // homebrew fish
                            completions_dir = if cfg!(target_arch = "aarch64") {
                                b"/opt/homebrew/share/fish/completions"
                            } else {
                                b"/usr/local/share/fish/completions"
                            };
                            if let Ok(d) = bun_sys::open_dir_absolute(completions_dir) {
                                break 'found d;
                            }
                        }

                        completions_dir = b"/etc/fish/completions";
                        if let Ok(d) = bun_sys::open_dir_absolute(completions_dir) {
                            break 'found d;
                        }
                    }
                    Shell::Zsh => {
                        if let Some(fpath) = env_var::fpath.get() {
                            for dir in strings::split(fpath, b" ") {
                                completions_dir = dir;
                                if let Ok(d) = bun_sys::open_dir_absolute(dir) {
                                    break 'found d;
                                }
                            }
                        }

                        if let Some(data_dir) = env_var::XDG_DATA_HOME.get() {
                            let paths: [&[u8]; 2] = [data_dir, b"./zsh-completions"];
                            completions_dir =
                                resolve_path::join_abs_string::<platform::Auto>(cwd, &paths);
                            if let Ok(d) = bun_sys::open_dir_absolute(completions_dir) {
                                break 'found d;
                            }
                        }

                        if let Some(home_dir) = env_var::BUN_INSTALL.get() {
                            completions_dir = home_dir;
                            if let Ok(d) = bun_sys::open_dir_absolute(home_dir) {
                                break 'found d;
                            }
                        }

                        if let Some(home_dir) = env_var::HOME.get() {
                            for dir in [b"./.oh-my-zsh/completions".as_slice(), b"./.bun"] {
                                let paths: [&[u8]; 2] = [home_dir, dir];
                                completions_dir =
                                    resolve_path::join_abs_string::<platform::Auto>(cwd, &paths);
                                if let Ok(d) = bun_sys::open_dir_absolute(completions_dir) {
                                    break 'found d;
                                }
                            }
                        }

                        const DIRS_TO_TRY: [&[u8]; 4] = [
                            b"/usr/local/share/zsh/site-functions",
                            b"/usr/local/share/zsh/completions",
                            b"/opt/homebrew/share/zsh/completions",
                            b"/opt/homebrew/share/zsh/site-functions",
                        ];

                        for dir in DIRS_TO_TRY {
                            completions_dir = dir;
                            if let Ok(d) = bun_sys::open_dir_absolute(dir) {
                                break 'found d;
                            }
                        }
                    }
                    Shell::Bash => {
                        for (base, dir) in [
                            (
                                env_var::XDG_DATA_HOME.get(),
                                b"./bash-completion/completions".as_slice(),
                            ),
                            (
                                env_var::XDG_CONFIG_HOME.get(),
                                b"./bash-completion/completions".as_slice(),
                            ),
                            (
                                env_var::HOME.get(),
                                b"./.oh-my-bash/custom/completions".as_slice(),
                            ),
                            (env_var::HOME.get(), b"./.bash_completion.d".as_slice()),
                        ] {
                            let Some(base) = base else { continue };
                            completions_dir =
                                resolve_path::join_abs_string::<platform::Auto>(cwd, &[base, dir]);
                            if let Ok(d) = bun_sys::open_dir_absolute(completions_dir) {
                                break 'found d;
                            }
                        }

                        const DIRS_TO_TRY: [&[u8]; 2] = [
                            b"/opt/homebrew/share/bash-completion/completions/",
                            b"/opt/local/share/bash-completion/completions/",
                        ];

                        for dir in DIRS_TO_TRY {
                            completions_dir = dir;
                            if let Ok(d) = bun_sys::open_dir_absolute(dir) {
                                break 'found d;
                            }
                        }
                    }
                    Shell::Unknown | Shell::Pwsh => unreachable!(),
                }

                pretty_errorln!(
                    "<r><red>error:<r> Could not find a directory to install completions in.\n",
                );

                if shell == Shell::Zsh {
                    pretty_errorln!(
                        "\nzsh tip: One of the directories in $fpath might work. If you use oh-my-zsh, try mkdir $HOME/.oh-my-zsh/completions; and bun completions again\n.",
                    );
                }

                print_errorln!(
                    "Please either pipe it:\n   bun completions > /to/a/file\n\n Or pass a directory:\n\n   bun completions /my/completions/dir\n",
                );
                Global::exit(fail_exit_code);
            };

            debug_assert!(!completions_dir.is_empty());

            let output_file: File = match File::create(output_dir, filename, true) {
                Ok(f) => f,
                Err(err) => {
                    pretty_errorln!(
                        "<r><red>error:<r> Could not open {} for writing: {}",
                        bstr::BStr::new(filename),
                        bstr::BStr::new(err.name()),
                    );
                    Global::exit(fail_exit_code);
                }
            };

            if let Err(err) = output_file.write_all(shell.completions()) {
                pretty_errorln!(
                    "<r><red>error:<r> Could not write to {}: {}",
                    bstr::BStr::new(filename),
                    bstr::BStr::new(err.name()),
                );
                Global::exit(fail_exit_code);
            }

            let _ = bun_sys::close(output_dir);

            // Check if they need to load the zsh completions file into their .zshrc
            if shell == Shell::Zsh {
                let mut completions_path_buf = bun_paths::path_buffer_pool::get();
                let completions_path: &[u8] = resolve_path::join_string_buf::<platform::Auto>(
                    &mut completions_path_buf,
                    &[completions_dir, filename],
                );
                let mut zshrc_filepath = bun_paths::path_buffer_pool::get();
                let needs_to_tell_them_to_add_completions_file: bool = 'brk: {
                    let dot_zshrc: File = 'zshrc: {
                        // https://zsh.sourceforge.io/Intro/intro_3.html
                        for (dir, name) in [
                            (env_var::ZDOTDIR.get(), b"/.zshrc".as_slice()),
                            (env_var::HOME.get(), b"/.zshrc".as_slice()),
                            (env_var::HOME.get(), b"/.zshenv".as_slice()),
                        ] {
                            let Some(dir) = dir else { continue };
                            let len = dir.len() + name.len();
                            zshrc_filepath[..dir.len()].copy_from_slice(dir);
                            zshrc_filepath[dir.len()..len].copy_from_slice(name);
                            zshrc_filepath[len] = 0;
                            if let Ok(f) = bun_sys::open_file_absolute_z(
                                bun_core::ZStr::from_buf(&zshrc_filepath[..], len),
                                bun_sys::OpenFlags::READ_WRITE,
                            ) {
                                break 'zshrc f;
                            }
                        }

                        break 'brk true;
                    };

                    // Sometimes, stat() says the file is 0 bytes: read at least 64 KB.
                    let Ok(end_pos) = dot_zshrc.get_end_pos() else {
                        break 'brk true;
                    };
                    let input_size = end_pos.max(64 * 1024);

                    let mut buf: Vec<u8> = vec![0u8; input_size + completions_path.len() * 4 + 96];

                    let Ok(read) = dot_zshrc.pread_all(&mut buf, 0) else {
                        break 'brk true;
                    };

                    let contents = &buf[..read];

                    // Do they possibly have it in the file already?
                    if strings::contains(contents, completions_path)
                        || strings::contains(contents, b"# bun completions")
                        || strings::contains(contents, b"/.bun/_bun")
                    {
                        break 'brk false;
                    }

                    // Okay, we need to add it

                    // We need to add it to the end of the file
                    let remaining = &mut buf[read..];
                    let extra = buf_print(
                        remaining,
                        format_args!(
                            "\n# bun completions\n[ -s \"{0}\" ] && source \"{0}\"\n",
                            bstr::BStr::new(completions_path)
                        ),
                    );

                    if dot_zshrc
                        .pwrite_all(extra, i64::try_from(read).expect("int cast"))
                        .is_err()
                    {
                        break 'brk true;
                    }

                    pretty_errorln!("<r><d>Enabled loading bun's completions in .zshrc<r>");
                    break 'brk false;
                };

                if needs_to_tell_them_to_add_completions_file {
                    pretty_errorln!(
                        "<r>To enable completions, add this to your .zshrc:\n      <b>[ -s \"{}\" ] && source \"{}\"",
                        bstr::BStr::new(completions_path),
                        bstr::BStr::new(completions_path),
                    );
                }
            }

            pretty_errorln!(
                "<r><d>Installed completions to {}/{}<r>\n",
                bstr::BStr::new(completions_dir),
                bstr::BStr::new(filename),
            );
            Output::flush();
            Ok(())
        }
    }
}

#[cfg(not(windows))]
use bun_core::fmt::{buf_print_infallible as buf_print, buf_print_z_infallible as buf_print_z};
