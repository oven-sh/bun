use core::ffi::c_int;

use bun_core::{Global, Output};
use bun_sys::{self as sys, Fd, O};

use crate::Command;
use bun_js::Run;

pub struct FuzzilliCommand;

#[cfg(feature = "fuzzilli")]
impl FuzzilliCommand {
    #[cold]
    pub fn exec(ctx: Command::Context) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        #[cfg(not(unix))]
        {
            Output::pretty_errorln(format_args!(
                "<r><red>error<r>: Fuzzilli mode is only supported on POSIX systems"
            ));
            Global::exit(1);
        }

        // Set an environment variable so we can detect fuzzilli mode in JavaScript

        // Verify REPRL file descriptors are available
        const REPRL_CRFD: c_int = 100;
        if Self::verify_fd(REPRL_CRFD).is_err() {
            Output::pretty_errorln(format_args!(
                "<r><red>error<r>: REPRL_CRFD (fd {}) is not available. Run Bun under Fuzzilli.",
                REPRL_CRFD
            ));
            Output::pretty_errorln(format_args!(
                "<r><d>Example: fuzzilli --profile=bun /path/to/bun fuzzilli<r>"
            ));
            Global::exit(1);
        }

        // Always embed the REPRL script (it's small and not worth the runtime overhead)
        let reprl_script: &'static [u8] = include_bytes!("../js/eval/fuzzilli-reprl.ts");

        // Open /tmp directory
        let temp_dir_fd: Fd = match sys::open(b"/tmp", O::DIRECTORY | O::RDONLY, 0) {
            sys::Result::Ok(fd) => fd,
            sys::Result::Err(_) => {
                Output::pretty_errorln(format_args!(
                    "<r><red>error<r>: Could not access /tmp directory"
                ));
                Global::exit(1);
            }
        };
        // `defer temp_dir_fd.close()` — handled by Drop on Fd

        // Create temp file for the script
        let temp_file_name: &[u8] = b"bun-fuzzilli-reprl.js";
        let temp_file_fd: Fd = match sys::openat(
            temp_dir_fd,
            temp_file_name,
            O::CREAT | O::WRONLY | O::TRUNC,
            0o644,
        ) {
            sys::Result::Ok(fd) => fd,
            sys::Result::Err(_) => {
                Output::pretty_errorln(format_args!(
                    "<r><red>error<r>: Could not create temp file"
                ));
                Global::exit(1);
            }
        };
        // `defer temp_file_fd.close()` — handled by Drop on Fd

        // Write the script to the temp file
        match sys::write(temp_file_fd, reprl_script) {
            sys::Result::Err(_) => {
                Output::pretty_errorln(format_args!(
                    "<r><red>error<r>: Could not write temp file"
                ));
                Global::exit(1);
            }
            sys::Result::Ok(_) => {}
        }

        Output::pretty_errorln(format_args!(
            "<r><d>[FUZZILLI] Temp file written, booting JS runtime<r>"
        ));

        // Run the temp file
        let temp_path: &[u8] = b"/tmp/bun-fuzzilli-reprl.js";
        Run::boot(ctx, temp_path, None)?;

        drop(temp_file_fd);
        drop(temp_dir_fd);
        Ok(())
    }

    fn verify_fd(fd: c_int) -> Result<(), bun_core::Error> {
        // TODO(port): Zig used std.posix.fstat directly; routed through bun_sys to avoid std I/O
        let _stat = sys::fstat(Fd::from_native(fd)).unwrap()?;
        Ok(())
    }
}

#[cfg(not(feature = "fuzzilli"))]
impl FuzzilliCommand {}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/fuzzilli_command.zig (74 lines)
//   confidence: medium
//   todos:      2
//   notes:      Environment.enable_fuzzilli mapped to cfg(feature="fuzzilli"); Output::pretty_errorln signature and bun_sys::Result match-arm names need Phase B fixup; Fd Drop assumed to close.
// ──────────────────────────────────────────────────────────────────────────
