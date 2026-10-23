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
    // The path of the cache is made absolute against the working directory, which no command has asked for this early.
    let _ = bun_resolver::fs::FileSystem::init(None);
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

fn refuse_another_revision(path: &[u8]) {
    let answer = bun_core::spawn_sync_read_stdout(&[path, b"--revision"], "BUN_OPTIONS");
    let revision = answer.as_deref().map(<[u8]>::trim_ascii);
    if revision == Some(Global::package_json_version_with_revision.as_bytes()) {
        return;
    }
    match revision {
        Some(revision) => {
            bun_core::err_generic!(
                "{} is Bun {}, and this is Bun {}",
                BStr::new(path),
                BStr::new(revision),
                Global::package_json_version_with_revision
            );
        }
        None => {
            bun_core::err_generic!("{} does not answer --revision", BStr::new(path));
        }
    }
    bun_core::pretty_errorln!(
        "<d>note<r>: ahead-of-time compilation runs in the bun-aot of the same revision as this Bun"
    );
    Output::flush();
    Global::exit(1);
}

/// Returns if this executable is that Bun.
#[cold]
#[inline(never)]
pub(crate) fn run_in_bun_with_compiler() {
    let Ok(this_executable) = bun_core::self_exe_path() else {
        return;
    };
    let this_executable = this_executable.as_bytes();
    let path = match find_beside(this_executable) {
        Some(path) => path,
        None if bun_core::env_var::BUN_AOT_DISABLE_DOWNLOAD
            .get()
            .unwrap_or(false) =>
        {
            return;
        }
        None => find_or_fetch(),
    };
    if path == this_executable {
        return;
    }
    refuse_another_revision(&path);

    // What `BUN_OPTIONS` put behind the name of the program, the other Bun puts there itself.
    let mut argv: Vec<&[u8]> = vec![path.as_slice()];
    for argument in bun_core::argv()
        .iter()
        .skip(1 + bun_core::bun_options_argc())
    {
        argv.push(argument);
    }
    Output::flush();
    #[cfg(unix)]
    Output::err_generic(
        "failed to run {}: errno {}",
        (BStr::new(&path), bun_core::exec_program(&argv)),
    );
    #[cfg(not(unix))]
    match bun_core::spawn_sync_inherit(&argv) {
        Ok(status) => Global::exit(u32::try_from(status.code()).unwrap_or(1)),
        Err(error) => Output::err_generic(
            "failed to run {}: {}",
            (BStr::new(&path), BStr::new(error.name())),
        ),
    }
    Output::flush();
    Global::exit(1);
}
