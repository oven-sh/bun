use core::fmt::Write as _;
use std::io::Write as _;

use bun_core::{env_var, Global, Output};
use bun_paths::{self as resolve_path, PathBuffer, WPathBuffer};
use bun_str::strings;
use bun_sys::{self, Dir, File};

use crate::shell_completions::{self as ShellCompletions, Shell};

pub struct InstallCompletionsCommand;

impl InstallCompletionsCommand {
    pub fn test_path(_: &[u8]) -> Result<Dir, bun_core::Error> {
        // TODO(port): Zig body is empty (`pub fn testPath(_: string) !std.fs.Dir {}`)
        unreachable!()
    }

    const BUNX_NAME: &'static str = if cfg!(debug_assertions) { "bunx-debug" } else { "bunx" };

    #[cfg(not(windows))]
    fn install_bunx_symlink_posix(cwd: &[u8]) -> Result<(), bun_core::Error> {
        let mut buf = PathBuffer::uninit();

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
        let mut target_buf = PathBuffer::uninit();
        let target = buf_print(
            &mut target_buf,
            format_args!(
                "{}/{}",
                bstr::BStr::new(bun_paths::dirname(exe).expect("exe has dirname")),
                Self::BUNX_NAME
            ),
        );
        if bun_sys::symlink(exe, target).is_ok() {
            return Ok(());
        }

        'outer: {
            if let Some(install_dir) = env_var::BUN_INSTALL.get() {
                let target = buf_print(
                    &mut target_buf,
                    format_args!("{}/bin/{}", bstr::BStr::new(install_dir), Self::BUNX_NAME),
                );
                if bun_sys::symlink(exe, target).is_err() {
                    break 'outer;
                }
                return Ok(());
            }
        }

        // if that fails, try $HOME/.bun/bin
        'outer: {
            if let Some(home_dir) = env_var::HOME.get() {
                let target = buf_print(
                    &mut target_buf,
                    format_args!("{}/.bun/bin/{}", bstr::BStr::new(home_dir), Self::BUNX_NAME),
                );
                if bun_sys::symlink(exe, target).is_err() {
                    break 'outer;
                }
                return Ok(());
            }
        }

        // if that fails, try $HOME/.local/bin
        'outer: {
            if let Some(home_dir) = env_var::HOME.get() {
                let target = buf_print(
                    &mut target_buf,
                    format_args!("{}/.local/bin/{}", bstr::BStr::new(home_dir), Self::BUNX_NAME),
                );
                if bun_sys::symlink(exe, target).is_err() {
                    break 'outer;
                }
                return Ok(());
            }
        }

        // otherwise...give up?
        Ok(())
    }

    #[cfg(windows)]
    fn install_bunx_symlink_windows(_cwd: &[u8]) -> Result<(), bun_core::Error> {
        use bun_str::{w, WStr};
        use bun_sys::windows;

        // Because symlinks are not always allowed on windows,
        // `bunx.exe` on windows is a hardlink to `bun.exe`
        // for this to work, we need to delete and recreate the hardlink every time
        let image_path: &[u16] = windows::exe_path_w();
        let last_sep = image_path
            .iter()
            .rposition(|&c| c == b'\\' as u16)
            .expect("unreachable");
        let image_dirname = &image_path[..last_sep + 1];

        let mut bunx_path_buf = WPathBuffer::uninit();

        // TODO(port): bun.strings.literal(u16, BUNX_NAME ++ ".cmd") — w!() needs a literal,
        // but BUNX_NAME is cfg-dependent. Phase B: const-concat or two cfg'd literals.
        let cmd_suffix: &[u16] = if cfg!(debug_assertions) {
            w!("bunx-debug.cmd")
        } else {
            w!("bunx.cmd")
        };
        let exe_suffix_z: &[u16] = if cfg!(debug_assertions) {
            w!("bunx-debug.exe\0")
        } else {
            w!("bunx.exe\0")
        };

        let delete_path = strings::concat_buf_t::<u16>(
            &mut bunx_path_buf,
            &[&windows::NT_OBJECT_PREFIX, image_dirname, cmd_suffix],
        )?;
        // TODO(port): std.os.windows.DeleteFile(.., .{ .dir = null }) — map to bun_sys::windows
        let _ = windows::delete_file(delete_path, None);

        let bunx_path_with_z = strings::concat_buf_t::<u16>(
            &mut bunx_path_buf,
            &[&windows::NT_OBJECT_PREFIX, image_dirname, exe_suffix_z],
        )?;
        // SAFETY: exe_suffix_z ends in NUL, so bunx_path_with_z[len-1] == 0
        let bunx_path = unsafe {
            WStr::from_raw(bunx_path_with_z.as_ptr(), bunx_path_with_z.len() - 1)
        };
        let _ = windows::delete_file(bunx_path.as_slice(), None);

        if windows::CreateHardLinkW(bunx_path.as_ptr(), image_path.as_ptr(), core::ptr::null_mut()) == 0 {
            // if hard link fails, use a cmd script
            const SCRIPT: &[u8] = b"@%~dp0bun.exe x %*\n";

            let bunx_cmd_with_z = strings::concat_buf_t::<u16>(
                &mut bunx_path_buf,
                &[&windows::NT_OBJECT_PREFIX, image_dirname, exe_suffix_z],
            )?;
            // SAFETY: exe_suffix_z ends in NUL
            let bunx_cmd = unsafe {
                WStr::from_raw(bunx_cmd_with_z.as_ptr(), bunx_cmd_with_z.len() - 1)
            };
            // TODO: fix this zig bug, it is one line change to a few functions.
            // const file = try std.fs.createFileAbsoluteW(bunx_cmd, .{});
            // TODO(port): std.fs.cwd().createFileW → bun_sys::File::create_w
            let file = File::create_w(bun_sys::Fd::cwd(), bunx_cmd)?;
            file.write_all(SCRIPT)?;
            // file dropped here (defer file.close())
        }
        Ok(())
    }

    fn install_bunx_symlink(cwd: &[u8]) -> Result<(), bun_core::Error> {
        #[cfg(windows)]
        {
            Self::install_bunx_symlink_windows(cwd)
        }
        #[cfg(not(windows))]
        {
            Self::install_bunx_symlink_posix(cwd)
        }
    }

    #[cfg(windows)]
    fn install_uninstaller_windows() -> Result<(), bun_core::Error> {
        use bun_str::w;
        use bun_sys::windows;

        // This uninstaller file is only written if the current exe is within a path
        // like `bun\bin\<whatever>.exe` so that it probably only runs when the
        // powershell `install.ps1` was used to install.

        let image_path: &[u16] = windows::exe_path_w();
        let last_sep = image_path
            .iter()
            .rposition(|&c| c == b'\\' as u16)
            .expect("unreachable");
        let image_dirname = &image_path[..last_sep];

        if !image_dirname.ends_with(w!("bun\\bin")) {
            return Ok(());
        }

        const CONTENT: &[u8] = include_bytes!("uninstall.ps1");

        let mut bunx_path_buf = WPathBuffer::uninit();
        let uninstaller_path = strings::concat_buf_t::<u16>(
            &mut bunx_path_buf,
            &[
                &windows::NT_OBJECT_PREFIX,
                &image_dirname[..image_dirname.len() - 3],
                w!("uninstall.ps1"),
            ],
        )?;

        // TODO(port): std.fs.cwd().createFileW → bun_sys::File::create_w
        let file = File::create_w(bun_sys::Fd::cwd(), uninstaller_path)?;
        file.write_all(CONTENT)?;
        // file dropped here (defer file.close())
        Ok(())
    }

    pub fn exec() -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        // Fail silently on auto-update.
        let fail_exit_code: u8 = if !env_var::IS_BUN_AUTO_UPDATE.get() { 1 } else { 0 };

        let mut cwd_buf = PathBuffer::uninit();

        let stdout = File::stdout();

        let mut shell = Shell::Unknown;
        if let Some(shell_name) = env_var::SHELL.platform_get() {
            // TODO(port): Shell.fromEnv(@TypeOf(shell_name), shell_name) — generic over u8/u16
            shell = Shell::from_env(shell_name);
        }

        let cwd: &[u8] = match bun_sys::getcwd(&mut cwd_buf) {
            Ok(cwd) => cwd,
            Err(_) => {
                // don't fail on this if we don't actually need to
                if fail_exit_code == 1 {
                    if !stdout.is_tty() {
                        if let Err(err) = stdout.write_all(shell.completions()) {
                            if err == bun_core::err!("BrokenPipe") {
                                Global::exit(0);
                            } else {
                                return Err(err);
                            }
                        }
                        Global::exit(0);
                    }
                }

                Output::pretty_errorln(
                    "<r><red>error<r>: Could not get current working directory",
                    format_args!(""),
                );
                Global::exit(fail_exit_code);
            }
        };

        let _ = Self::install_bunx_symlink(cwd);

        #[cfg(windows)]
        {
            let _ = Self::install_uninstaller_windows();
        }

        // TODO: https://github.com/oven-sh/bun/issues/8939
        #[cfg(windows)]
        {
            Output::err_generic("PowerShell completions are not yet written for Bun yet.", format_args!(""));
            Output::print_errorln("See https://github.com/oven-sh/bun/issues/8939", format_args!(""));
            return Ok(());
        }

        match shell {
            Shell::Unknown => {
                Output::err_generic(
                    "Unknown or unsupported shell. Please set $SHELL to one of zsh, fish, or bash.",
                    format_args!(""),
                );
                Output::note("To manually output completions, run 'bun getcompletes'", format_args!(""));
                Global::exit(fail_exit_code);
            }
            _ => {}
        }

        if !env_var::IS_BUN_AUTO_UPDATE.get() {
            if !stdout.is_tty() {
                if let Err(err) = stdout.write_all(shell.completions()) {
                    if err == bun_core::err!("BrokenPipe") {
                        Global::exit(0);
                    } else {
                        return Err(err);
                    }
                }
                Global::exit(0);
            }
        }

        let mut completions_dir: &[u8] = b"";
        let output_dir: Dir = 'found: {
            let argv = bun_core::argv();
            for (i, arg) in argv.iter().enumerate() {
                if arg == b"completions" {
                    if argv.len() > i + 1 {
                        let input: &[u8] = &argv[i + 1];

                        if !bun_paths::is_absolute(input) {
                            completions_dir = resolve_path::join_abs(cwd, resolve_path::Platform::Auto, input);
                        } else {
                            completions_dir = input;
                        }

                        if !bun_paths::is_absolute(completions_dir) {
                            Output::pretty_errorln(
                                "<r><red>error:<r> Please pass an absolute path. {s} is invalid",
                                format_args!("{}", bstr::BStr::new(completions_dir)),
                            );
                            Global::exit(fail_exit_code);
                        }

                        match bun_sys::open_dir_absolute(completions_dir) {
                            Ok(d) => break 'found d,
                            Err(err) => {
                                Output::pretty_errorln(
                                    "<r><red>error:<r> accessing {s} errored {s}",
                                    format_args!(
                                        "{} {}",
                                        bstr::BStr::new(completions_dir),
                                        err.name()
                                    ),
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
                    if let Some(config_dir) = env_var::XDG_CONFIG_HOME.get() {
                        let paths: [&[u8]; 2] = [config_dir, b"./fish/completions"];
                        completions_dir = resolve_path::join_abs_string(cwd, &paths, resolve_path::Platform::Auto);
                        if let Ok(d) = bun_sys::open_dir_absolute(completions_dir) {
                            break 'found d;
                        }
                    }

                    if let Some(data_dir) = env_var::XDG_DATA_HOME.get() {
                        let paths: [&[u8]; 2] = [data_dir, b"./fish/completions"];
                        completions_dir = resolve_path::join_abs_string(cwd, &paths, resolve_path::Platform::Auto);
                        if let Ok(d) = bun_sys::open_dir_absolute(completions_dir) {
                            break 'found d;
                        }
                    }

                    if let Some(home_dir) = env_var::HOME.get() {
                        let paths: [&[u8]; 2] = [home_dir, b"./.config/fish/completions"];
                        completions_dir = resolve_path::join_abs_string(cwd, &paths, resolve_path::Platform::Auto);
                        if let Ok(d) = bun_sys::open_dir_absolute(completions_dir) {
                            break 'found d;
                        }
                    }

                    #[cfg(target_os = "macos")]
                    {
                        #[cfg(not(target_arch = "aarch64"))]
                        {
                            // homebrew fish
                            completions_dir = b"/usr/local/share/fish/completions";
                            if let Ok(d) = bun_sys::open_dir_absolute(b"/usr/local/share/fish/completions") {
                                break 'found d;
                            }
                        }
                        #[cfg(target_arch = "aarch64")]
                        {
                            // homebrew fish
                            completions_dir = b"/opt/homebrew/share/fish/completions";
                            if let Ok(d) = bun_sys::open_dir_absolute(b"/opt/homebrew/share/fish/completions") {
                                break 'found d;
                            }
                        }
                    }

                    {
                        completions_dir = b"/etc/fish/completions";
                        if let Ok(d) = bun_sys::open_dir_absolute(b"/etc/fish/completions") {
                            break 'found d;
                        }
                    }
                }
                Shell::Zsh => {
                    if let Some(fpath) = env_var::fpath.get() {
                        for dir in fpath.split(|b| *b == b' ') {
                            completions_dir = dir;
                            if let Ok(d) = bun_sys::open_dir_absolute(dir) {
                                break 'found d;
                            }
                        }
                    }

                    if let Some(data_dir) = env_var::XDG_DATA_HOME.get() {
                        let paths: [&[u8]; 2] = [data_dir, b"./zsh-completions"];
                        completions_dir = resolve_path::join_abs_string(cwd, &paths, resolve_path::Platform::Auto);
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
                        {
                            let paths: [&[u8]; 2] = [home_dir, b"./.oh-my-zsh/completions"];
                            completions_dir = resolve_path::join_abs_string(cwd, &paths, resolve_path::Platform::Auto);
                            if let Ok(d) = bun_sys::open_dir_absolute(completions_dir) {
                                break 'found d;
                            }
                        }

                        {
                            let paths: [&[u8]; 2] = [home_dir, b"./.bun"];
                            completions_dir = resolve_path::join_abs_string(cwd, &paths, resolve_path::Platform::Auto);
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
                    if let Some(data_dir) = env_var::XDG_DATA_HOME.get() {
                        let paths: [&[u8]; 2] = [data_dir, b"./bash-completion/completions"];
                        completions_dir = resolve_path::join_abs_string(cwd, &paths, resolve_path::Platform::Auto);
                        if let Ok(d) = bun_sys::open_dir_absolute(completions_dir) {
                            break 'found d;
                        }
                    }

                    if let Some(config_dir) = env_var::XDG_CONFIG_HOME.get() {
                        let paths: [&[u8]; 2] = [config_dir, b"./bash-completion/completions"];
                        completions_dir = resolve_path::join_abs_string(cwd, &paths, resolve_path::Platform::Auto);
                        if let Ok(d) = bun_sys::open_dir_absolute(completions_dir) {
                            break 'found d;
                        }
                    }

                    if let Some(home_dir) = env_var::HOME.get() {
                        {
                            let paths: [&[u8]; 2] = [home_dir, b"./.oh-my-bash/custom/completions"];
                            completions_dir = resolve_path::join_abs_string(cwd, &paths, resolve_path::Platform::Auto);
                            if let Ok(d) = bun_sys::open_dir_absolute(completions_dir) {
                                break 'found d;
                            }
                        }
                        {
                            let paths: [&[u8]; 2] = [home_dir, b"./.bash_completion.d"];
                            completions_dir = resolve_path::join_abs_string(cwd, &paths, resolve_path::Platform::Auto);
                            if let Ok(d) = bun_sys::open_dir_absolute(completions_dir) {
                                break 'found d;
                            }
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
                _ => unreachable!(),
            }

            Output::pretty_errorln(
                "<r><red>error:<r> Could not find a directory to install completions in.\n",
                format_args!(""),
            );

            if shell == Shell::Zsh {
                Output::pretty_errorln(
                    "\nzsh tip: One of the directories in $fpath might work. If you use oh-my-zsh, try mkdir $HOME/.oh-my-zsh/completions; and bun completions again\n.",
                    format_args!(""),
                );
            }

            Output::print_errorln(
                "Please either pipe it:\n   bun completions > /to/a/file\n\n Or pass a directory:\n\n   bun completions /my/completions/dir\n",
                format_args!(""),
            );
            Global::exit(fail_exit_code);
        };

        let filename: &[u8] = match shell {
            Shell::Fish => b"bun.fish",
            Shell::Zsh => b"_bun",
            Shell::Bash => b"bun.completion.bash",
            _ => unreachable!(),
        };

        debug_assert!(!completions_dir.is_empty());

        // TODO(port): output_dir.createFileZ(filename, .{ .truncate = true }) → bun_sys::Dir::create_file_z
        let output_file = match output_dir.create_file_z(filename, true) {
            Ok(f) => f,
            Err(err) => {
                Output::pretty_errorln(
                    "<r><red>error:<r> Could not open {s} for writing: {s}",
                    format_args!("{} {}", bstr::BStr::new(filename), err.name()),
                );
                Global::exit(fail_exit_code);
            }
        };

        if let Err(err) = output_file.write_all(shell.completions()) {
            Output::pretty_errorln(
                "<r><red>error:<r> Could not write to {s}: {s}",
                format_args!("{} {}", bstr::BStr::new(filename), err.name()),
            );
            Global::exit(fail_exit_code);
        }

        // defer output_file.close() — handled by Drop
        drop(output_dir);

        // Check if they need to load the zsh completions file into their .zshrc
        if shell == Shell::Zsh {
            let mut completions_absolute_path_buf = PathBuffer::uninit();
            let completions_path = bun_sys::get_fd_path(
                bun_sys::Fd::from_file(&output_file),
                &mut completions_absolute_path_buf,
            )
            .expect("unreachable");
            let mut zshrc_filepath = PathBuffer::uninit();
            let needs_to_tell_them_to_add_completions_file: bool = 'brk: {
                let dot_zshrc: File = 'zshrc: {
                    'first: {
                        // https://zsh.sourceforge.io/Intro/intro_3.html
                        // There are five startup files that zsh will read commands from:
                        // $ZDOTDIR/.zshenv
                        // $ZDOTDIR/.zprofile
                        // $ZDOTDIR/.zshrc
                        // $ZDOTDIR/.zlogin
                        // $ZDOTDIR/.zlogout

                        if let Some(zdot_dir) = env_var::ZDOTDIR.get() {
                            zshrc_filepath[..zdot_dir.len()].copy_from_slice(zdot_dir);
                            zshrc_filepath[zdot_dir.len()..zdot_dir.len() + b"/.zshrc".len()]
                                .copy_from_slice(b"/.zshrc");
                            zshrc_filepath[zdot_dir.len() + b"/.zshrc".len()] = 0;
                            // SAFETY: NUL written at zdot_dir.len() + "/.zshrc".len() above
                            let filepath = unsafe {
                                bun_str::ZStr::from_raw(
                                    zshrc_filepath.as_ptr(),
                                    zdot_dir.len() + b"/.zshrc".len(),
                                )
                            };
                            match bun_sys::open_file_absolute_z(filepath, bun_sys::OpenMode::ReadWrite) {
                                Ok(f) => break 'zshrc f,
                                Err(_) => break 'first,
                            }
                        }
                    }

                    'second: {
                        if let Some(zdot_dir) = env_var::HOME.get() {
                            zshrc_filepath[..zdot_dir.len()].copy_from_slice(zdot_dir);
                            zshrc_filepath[zdot_dir.len()..zdot_dir.len() + b"/.zshrc".len()]
                                .copy_from_slice(b"/.zshrc");
                            zshrc_filepath[zdot_dir.len() + b"/.zshrc".len()] = 0;
                            // SAFETY: NUL written at zdot_dir.len() + "/.zshrc".len() above
                            let filepath = unsafe {
                                bun_str::ZStr::from_raw(
                                    zshrc_filepath.as_ptr(),
                                    zdot_dir.len() + b"/.zshrc".len(),
                                )
                            };
                            match bun_sys::open_file_absolute_z(filepath, bun_sys::OpenMode::ReadWrite) {
                                Ok(f) => break 'zshrc f,
                                Err(_) => break 'second,
                            }
                        }
                    }

                    'third: {
                        if let Some(zdot_dir) = env_var::HOME.get() {
                            zshrc_filepath[..zdot_dir.len()].copy_from_slice(zdot_dir);
                            zshrc_filepath[zdot_dir.len()..zdot_dir.len() + b"/.zshenv".len()]
                                .copy_from_slice(b"/.zshenv");
                            zshrc_filepath[zdot_dir.len() + b"/.zshenv".len()] = 0;
                            // SAFETY: NUL written at zdot_dir.len() + "/.zshenv".len() above
                            let filepath = unsafe {
                                bun_str::ZStr::from_raw(
                                    zshrc_filepath.as_ptr(),
                                    zdot_dir.len() + b"/.zshenv".len(),
                                )
                            };
                            match bun_sys::open_file_absolute_z(filepath, bun_sys::OpenMode::ReadWrite) {
                                Ok(f) => break 'zshrc f,
                                Err(_) => break 'third,
                            }
                        }
                    }

                    break 'brk true;
                };

                // Sometimes, stat() lies to us and says the file is 0 bytes
                // Let's not trust it and read the whole file
                let Ok(end_pos) = dot_zshrc.get_end_pos() else { break 'brk true };
                let input_size = end_pos.max(64 * 1024);

                // defer dot_zshrc.close() — handled by Drop
                let mut buf: Vec<u8> = vec![0u8; usize::try_from(input_size).unwrap() + completions_path.len() * 4 + 96];

                let Ok(read) = dot_zshrc.pread_all(&mut buf, 0) else { break 'brk true };

                #[cfg(windows)]
                {
                    dot_zshrc.seek_to(0)?;
                }

                let contents = &buf[..read];

                // Do they possibly have it in the file already?
                if strings::contains(contents, completions_path)
                    || strings::contains(contents, b"# bun completions\n")
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

                if dot_zshrc.pwrite_all(extra, u64::try_from(read).unwrap()).is_err() {
                    break 'brk true;
                }

                Output::pretty_errorln(
                    "<r><d>Enabled loading bun's completions in .zshrc<r>",
                    format_args!(""),
                );
                break 'brk false;
            };

            if needs_to_tell_them_to_add_completions_file {
                Output::pretty_errorln(
                    "<r>To enable completions, add this to your .zshrc:\n      <b>[ -s \"{s}\" ] && source \"{s}\"",
                    format_args!(
                        "{0} {0}",
                        bstr::BStr::new(completions_path)
                    ),
                );
            }
        }

        Output::pretty_errorln(
            "<r><d>Installed completions to {s}/{s}<r>\n",
            format_args!(
                "{} {}",
                bstr::BStr::new(completions_dir),
                bstr::BStr::new(filename)
            ),
        );
        Output::flush();
        Ok(())
    }
}

/// Helper: write `args` into `buf` and return the written subslice.
/// Mirrors `std.fmt.bufPrint(buf, fmt, args) catch unreachable`.
// TODO(port): move to bun_str or bun_core if widely reused
fn buf_print<'a>(buf: &'a mut [u8], args: core::fmt::Arguments<'_>) -> &'a mut [u8] {
    let total = buf.len();
    let mut cursor: &mut [u8] = buf;
    cursor.write_fmt(args).expect("unreachable");
    let remaining = cursor.len();
    let written = total - remaining;
    // PORT NOTE: reshaped for borrowck — re-slice from original buffer
    // SAFETY: `written` bytes were just written contiguously from buf[0]
    unsafe { core::slice::from_raw_parts_mut(buf.as_mut_ptr(), written) }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/install_completions_command.zig (550 lines)
//   confidence: medium
//   todos:      7
//   notes:      Heavy std.fs usage mapped to bun_sys placeholders (open_dir_absolute, create_file_z, open_file_absolute_z, File::create_w); Output::pretty_errorln fmt-string vs args calling convention needs Phase B reconciliation; resolve_path::join_abs_string returns threadlocal-buffer slices — borrowck across iterations may need owned copies.
// ──────────────────────────────────────────────────────────────────────────
