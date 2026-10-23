//! A Bun that is built without the ahead-of-time compiler runs the command in the Bun that has it: `bun-aot` of the same
//! version. It lies beside this executable, or in the cache that `--target` fills, or is fetched as `--target` fetches.

use bstr::BStr;
use bun_core::{Global, Output};
use bun_options_types::compile_target::CompileTarget;
use bun_standalone_graph::StandaloneModuleGraph::target_executable;

fn find_beside(this_executable: &[u8]) -> Option<Vec<u8>> {
    let name: &[u8] = if cfg!(windows) {
        b"bun-aot.exe"
    } else {
        b"bun-aot"
    };
    let mut path = bun_paths::dirname_simple(this_executable).to_vec();
    path.push(bun_paths::SEP);
    path.extend_from_slice(name);
    bun_sys::exists(&path).then_some(path)
}

fn find_or_fetch() -> Vec<u8> {
    let target = CompileTarget::with_compiler();
    let mut env = bun_dotenv::Loader::init();
    let _ = env.load_process();
    match target_executable(&target, &mut env, None) {
        Ok(path) => path.as_bytes().to_vec(),
        Err(error) => {
            Output::err_generic("{}", (BStr::new(error.slice()),));
            bun_core::pretty_errorln!(
                "<d>note<r>: ahead-of-time compilation runs in {}, which Bun downloads once, from npm",
                target
            );
            Output::flush();
            Global::exit(1);
        }
    }
}

/// Returns if this executable is that Bun.
#[cold]
#[inline(never)]
pub(crate) fn run_in_bun_with_compiler() {
    let Ok(this_executable) = bun_core::self_exe_path() else {
        return;
    };
    let this_executable = this_executable.as_bytes();
    let path = find_beside(this_executable).unwrap_or_else(find_or_fetch);
    if path == this_executable {
        return;
    }

    // What `BUN_OPTIONS` put behind the name of the program, the other Bun puts there itself.
    let mut argv: Vec<&[u8]> = vec![path.as_slice()];
    for argument in bun_core::argv()
        .iter()
        .skip(1 + bun_core::bun_options_argc())
    {
        argv.push(argument);
    }
    Output::flush();
    match bun_core::spawn_sync_inherit(&argv) {
        Ok(status) => Global::exit(u32::try_from(status.code()).unwrap_or(1)),
        Err(error) => {
            Output::err_generic(
                "failed to run {}: {}",
                (BStr::new(&path), BStr::new(error.name())),
            );
            Output::flush();
            Global::exit(1);
        }
    }
}
