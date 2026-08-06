#[cfg(unix)]
use core::ffi::c_int;

#[cfg(unix)]
use bun_core::zstr;
use bun_core::{Environment, Global};
#[cfg(unix)]
use bun_sys::{self as sys, Fd, FdExt, O};

#[cfg(unix)]
use super::run_command::RunCommand;
use crate::Command;

pub(crate) struct FuzzilliCommand;

impl FuzzilliCommand {
    #[cold]
    pub(crate) fn exec(_ctx: Command::Context) -> Result<(), crate::Error> {
        // The dispatch site (`cli/mod.rs`) already gates on `ENABLE_FUZZILLI`, so
        // this body is unreachable when the flag is off; bail loudly if a caller
        // ever invokes it anyway.
        if !Environment::ENABLE_FUZZILLI {
            bun_core::pretty_errorln!(
                "<r><red>error<r>: Fuzzilli mode is not enabled in this build"
            );
            Global::exit(1);
        }

        #[cfg(not(unix))]
        {
            bun_core::pretty_errorln!(
                "<r><red>error<r>: Fuzzilli mode is only supported on POSIX systems"
            );
            Global::exit(1);
        }

        #[cfg(unix)]
        {
            // Set an environment variable so we can detect fuzzilli mode in JavaScript

            // Verify REPRL file descriptors are available
            const REPRL_CRFD: c_int = 100;
            if Self::verify_fd(REPRL_CRFD).is_err() {
                bun_core::pretty_errorln!(
                    "<r><red>error<r>: REPRL_CRFD (fd {}) is not available. Run Bun under Fuzzilli.",
                    REPRL_CRFD
                );
                bun_core::pretty_errorln!(
                    "<r><d>Example: fuzzilli --profile=bun /path/to/bun fuzzilli<r>"
                );
                Global::exit(1);
            }

            // Always embed the REPRL script (it's small and not worth the runtime overhead)
            let reprl_script: &'static [u8] = include_bytes!("../../js/eval/fuzzilli-reprl.ts");

            // Open /tmp directory
            let temp_dir_fd: Fd = match sys::open(zstr!("/tmp"), O::DIRECTORY | O::RDONLY, 0) {
                Ok(fd) => fd,
                Err(_) => {
                    bun_core::pretty_errorln!("<r><red>error<r>: Could not access /tmp directory");
                    Global::exit(1);
                }
            };

            // Create temp file for the script
            let temp_file_fd: Fd = match sys::openat(
                temp_dir_fd,
                zstr!("bun-fuzzilli-reprl.js"),
                O::CREAT | O::WRONLY | O::TRUNC,
                0o644,
            ) {
                Ok(fd) => fd,
                Err(_) => {
                    bun_core::pretty_errorln!("<r><red>error<r>: Could not create temp file");
                    Global::exit(1);
                }
            };

            // Write the script to the temp file
            match sys::write(temp_file_fd, reprl_script) {
                Err(_) => {
                    bun_core::pretty_errorln!("<r><red>error<r>: Could not write temp file");
                    Global::exit(1);
                }
                Ok(_) => {}
            }

            bun_core::pretty_errorln!("<r><d>[FUZZILLI] Temp file written, booting JS runtime<r>");

            // Run the temp file
            let temp_path: &[u8] = b"/tmp/bun-fuzzilli-reprl.js";
            // The `Run.boot` entry point is hosted on `RunCommand` to avoid the
            // higher-tier crate cycle (see run_command.rs §`Run`).
            let result = RunCommand::boot(_ctx, temp_path.to_vec().into_boxed_slice(), None);

            // `defer fd.close()` — Fd is Copy and has no Drop; close explicitly.
            temp_file_fd.close();
            temp_dir_fd.close();

            result
        }
    }

    #[cfg(unix)]
    fn verify_fd(fd: c_int) -> sys::Maybe<()> {
        // Routed through `bun_sys` to preserve syscall-tagged error info.
        let _stat = sys::fstat(Fd::from_native(fd))?;
        Ok(())
    }
}
