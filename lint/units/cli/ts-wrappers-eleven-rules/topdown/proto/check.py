#!/usr/bin/env python3
# SCRATCH PROBE of the research unit "ts-wrappers-eleven-rules" (from the one of "ts-entry-codes-harness"), not part of the change.
# Copies src/lint of the worktree to a scratch directory, lays the planned files of src-lint/ beside this script over it,
# adds probe_main.rs (the planned `parse` of lint_command.rs and a dump of node ranges) and compiles it as ONE binary with
# rustc against the rlibs of the debug build of the worktree: no crate is rebuilt. This copy runs clippy-driver with the lint flags of the workspace as warnings and emits metadata only.
# usage: /workspace/tools/lk python3 check.py [out dir]
# The binary <out>/tsentry takes the operands of `bun --lint` (a leading `--lint` is dropped) and writes what the
# planned command writes to stderr; see probe_main.rs for the environment variables that change what it prints.
import glob, json, os, shutil, subprocess, sys

WT = os.environ.get("WT", "/workspace/wt/cli")
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/w1b-topdown/check"
SRC = f"{OUT}/src"
shutil.rmtree(SRC, ignore_errors=True)
shutil.copytree(f"{WT}/src/lint", SRC, ignore=shutil.ignore_patterns("Cargo.toml", "LICENSE*", "UPSTREAM*"))

# The planned text of this research unit replaces the files of the tree that it changes.
for root, _, names in os.walk(f"{HERE}/src-lint"):
    for name in names:
        rel = os.path.relpath(os.path.join(root, name), f"{HERE}/src-lint")
        shutil.copy(os.path.join(root, name), f"{SRC}/{rel}")
open(f"{SRC}/lib.rs", "a").write('''
#[path = "%s/src/js_parser/native_test_shims.rs"]
mod native_test_shims;
#[allow(non_snake_case)]
mod Macro {
    pub use bun_js_parser::Macro::MacroRemapEntry;
}
#[path = "/workspace/notes/lint/units/cli/d1-rust-tests-topdown/later/dtoa.rs"]
mod dtoa;
mod probe_main;
fn main() {
    probe_main::main();
}
#[unsafe(no_mangle)]
extern "C" fn WTF__DumpStackTrace(_: *const core::ffi::c_void, _: usize) {}
#[unsafe(no_mangle)]
extern "C" fn posix_spawn_bun() -> i32 {
    -1
}
''' % WT)
shutil.copy(f"{HERE}/probe_main.rs", f"{SRC}/probe_main.rs")
os.rename(f"{SRC}/lib.rs", f"{SRC}/main.rs")

deps = f"{WT}/build/debug/rust-target/x86_64-unknown-linux-gnu/deps"
unit = json.load(open(glob.glob(f"{WT}/build/debug/rust-target/units/bun_lint-*.json")[0]))
args = []
skip = 0
a = unit["args"]
for i, x in enumerate(a):
    if skip:
        skip -= 1
        continue
    if x == "--crate-name":
        args += ["--crate-name", "tsentry"]; skip = 1
    elif x == "src/lint/lib.rs":
        args.append(f"{SRC}/main.rs")
    elif x == "--crate-type":
        args += ["--crate-type", "bin"]; skip = 1
    elif x.startswith("--emit="):
        args.append("--emit=metadata")
    elif x in ("--error-format=json",) or x.startswith("--json="):
        continue
    elif x.startswith("--deny=") or x.startswith("--forbid="):
        args.append("--warn=" + x.split("=", 1)[1])
    elif x == "-C" and (a[i + 1].startswith("metadata=") or a[i + 1].startswith("extra-filename=") or a[i + 1].startswith("incremental=")):
        skip = 1
    elif x == "--out-dir":
        args += ["--out-dir", OUT]; skip = 1
    elif x == "-Z" and a[i + 1] == "binary-dep-depinfo":
        skip = 1
    else:
        args.append(x)
for name in ["bun_ast", "bun_js_parser", "bun_core", "bun_alloc"]:
    rlib = glob.glob(f"{deps}/lib{name}-*.rlib")
    assert len(rlib) == 1, (name, rlib)
    args += ["--extern", f"{name}={rlib[0]}"]
fixed = []
for x in args:
    if x.startswith("noprelude,nounused:") and x.endswith(".rmeta"):
        fixed.append(x[:-6] + ".rlib")
        fixed.append("--extern"); fixed.append(x)
    else:
        fixed.append(x)
args = fixed
args += ["--allow=unused_crate_dependencies"]
env = dict(os.environ)
env.update(unit["env"])
env["CARGO_CRATE_NAME"] = "tsentry"
r = subprocess.run([os.path.join(os.path.dirname(unit["rustc"]), "clippy-driver")] + args, cwd=WT, env=env)
sys.exit(r.returncode)
