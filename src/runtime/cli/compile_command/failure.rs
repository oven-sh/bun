use std::io::Write as _;

use bun_core::fmt as bun_fmt;
use bun_exe_format::identity::IdentityError;
use bun_options_types::compile_target::CompileTarget;

use super::{AssetError, CompileFailure, RequestOrigin};

impl CompileFailure {
    // Lines without `error: `. The first is the error, a line that starts with `note: ` is a note.
    pub(crate) fn write_message(
        &self,
        request_origin: RequestOrigin,
        target: &CompileTarget,
        out: &mut Vec<u8>,
    ) {
        match self {
            CompileFailure::NoCompiler => write_unavailable(request_origin, out),
            CompileFailure::NoIdentity(error) => {
                write_unavailable(request_origin, out);
                let reason: &[u8] = match error {
                    IdentityError::NoBuildId => b": it was linked without a build id",
                    IdentityError::UnrecognizedExecutable | IdentityError::Malformed => {
                        b": its build id could not be read"
                    }
                };
                out.extend_from_slice(reason);
            }
            CompileFailure::CrossCompilation => {
                out.extend_from_slice(request_origin.subject().as_bytes());
                out.extend_from_slice(
                    b" can't cross-compile. It only builds for the platform it runs on",
                );
                if request_origin == RequestOrigin::CompileCommand {
                    out.extend_from_slice(b"\nnote: run this on the target platform, or pass --no-aot to bundle your code with the Bun runtime instead, like bun build --compile");
                }
            }
            CompileFailure::TemplateUnreadable { error } => {
                let _ = write!(out, "failed to read executable for '{target}': {error}");
            }
            CompileFailure::TemplateIsNotBun { path } => {
                out.extend_from_slice(path);
                out.extend_from_slice(b" can't run code compiled by this Bun. It isn't a Bun executable, or it's a different version. Use the same version of Bun, built for this platform");
            }
            CompileFailure::TemplateDiffers { path, difference } => {
                out.extend_from_slice(path);
                out.extend_from_slice(b" can't run code compiled by this Bun: ");
                out.extend_from_slice(difference);
                out.extend_from_slice(
                    b"\nnote: use a Bun built from the same sources with the same configuration",
                );
            }
            CompileFailure::Build { .. } => {}
            CompileFailure::Assets(error) => write_asset_error(error, out),
            CompileFailure::Trim(error) => error.write_message(out),
            CompileFailure::Executable(error) => out.extend_from_slice(error.slice()),
            CompileFailure::Graph(error) => {
                out.extend_from_slice(b"failed to create executable: ");
                out.extend_from_slice(error.name().as_bytes());
            }
            CompileFailure::OverwritesEntryPoint { outfile } => {
                write_overwrite(request_origin, outfile, b"an entry point", out);
            }
            CompileFailure::OverwritesSource { outfile } => {
                write_overwrite(request_origin, outfile, b"part of the program", out);
            }
            CompileFailure::FileNotWritten { path, error } => {
                out.extend_from_slice(b"failed to write ");
                out.extend_from_slice(path);
                let _ = write!(out, ": {error}");
            }
            CompileFailure::SourceChanged { path } => {
                out.extend_from_slice(path);
                out.extend_from_slice(b" changed while the build was running, so a source map would show code that the executable doesn't run\nnote: run the build again");
            }
        }
    }
}

fn write_asset_error(error: &AssetError, out: &mut Vec<u8>) {
    let _ = match error {
        AssetError::WorkingDirectoryUnreadable(error) => {
            write!(out, "failed to read the working directory: {error}")
        }
        AssetError::Unreadable { asset, error } => {
            write!(
                out,
                "failed to read asset {}: {error}",
                bun_fmt::quote(asset)
            )
        }
        AssetError::EmbedsAtEntryPoint { asset } => write!(
            out,
            "asset {} would embed at the same path as the entry point; use a different outfile",
            bun_fmt::quote(asset),
        ),
        AssetError::Collides { asset, path } => write!(
            out,
            "asset {} collides with another embedded file at {}",
            bun_fmt::quote(asset),
            bun_fmt::quote(path),
        ),
        AssetError::NotCollected(text) => out.write_all(text.as_bytes()),
    };
}

fn write_overwrite(origin: RequestOrigin, outfile: &[u8], role: &[u8], out: &mut Vec<u8>) {
    let option: &[u8] = match origin {
        RequestOrigin::CompileCommand | RequestOrigin::BuildFlag => b"--outfile",
        RequestOrigin::BuildApi => b"compile.outfile",
    };
    let parts: [&[u8]; 6] = [
        b"the executable would overwrite ",
        outfile,
        b", which is ",
        role,
        b". Choose another path with ",
        option,
    ];
    out.extend_from_slice(&parts.concat());
}
fn write_unavailable(origin: RequestOrigin, out: &mut Vec<u8>) {
    let subject = match origin {
        RequestOrigin::CompileCommand => "ahead-of-time compilation",
        RequestOrigin::BuildFlag | RequestOrigin::BuildApi => origin.subject(),
    };
    out.extend_from_slice(subject.as_bytes());
    out.extend_from_slice(b" isn't available in this build of Bun");
}
