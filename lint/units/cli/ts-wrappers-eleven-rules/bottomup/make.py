#!/usr/bin/env python3
# SCRATCH PROBE of the research unit "ts-entry-codes-harness", not part of the change.
# Copies src/lint of the worktree to a scratch directory, makes the edit that D2 plans in lib.rs and context.rs
# (`ParsedOnly` -> `ParsedForLint`, the arena read from the parse), adds probe_main.rs (the planned `parse` of lint_command.rs)
# and compiles it as ONE binary with rustc against the rlibs of the debug build of the worktree: no crate is rebuilt.
# usage: /workspace/tools/lk python3 make.py [out dir]      default out dir: /tmp/tsentry
# The binary <out>/tsentry takes the operands of `bun --lint` (a leading `--lint` is dropped) and writes what the
# planned command writes to stderr; see probe_main.rs for the environment variables that change what it prints.
import glob, json, os, shutil, subprocess, sys

WT = os.environ.get("WT", "/workspace/wt/cli")
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/tsw/out"
SRC = f"{OUT}/src"
shutil.rmtree(SRC, ignore_errors=True)
shutil.copytree(f"{WT}/src/lint", SRC, ignore=shutil.ignore_patterns("Cargo.toml", "LICENSE*", "UPSTREAM*"))

def edit(name, pairs):
    path = f"{SRC}/{name}"
    text = open(path).read()
    for old, new in pairs:
        assert text.count(old) == 1, (name, old, text.count(old))
        text = text.replace(old, new)
    open(path, "w").write(text)

edit("lib.rs", [
    ("use bun_js_parser::parse::parse_entry::ParsedOnly;", "use bun_js_parser::parse::parse_entry::ParsedForLint;"),
    ("    parsed: &ParsedOnly<'_, 'a>,\n    source: &'a bun_ast::Source,\n    arena: &'a bun_alloc::Arena,\n", "    parsed: &ParsedForLint<'_, 'a>,\n    source: &'a bun_ast::Source,\n"),
    ("context::Context::new(file, parsed, source, arena)", "context::Context::new(file, parsed, source)"),
])
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
OVERLAY = f"{HERE}/overlay"
for root, _, files in os.walk(OVERLAY):
    for name in files:
        rel = os.path.relpath(os.path.join(root, name), OVERLAY)
        shutil.copy(os.path.join(root, name), f"{SRC}/{rel}")
edit("lib.rs", [
    ("    parsed: &ParsedForLint<'_, 'a>,\n    source: &'a bun_ast::Source,\n", "    parsed: &ParsedForLint<'_, 'a>,\n    source: &'a bun_ast::Source,\n    loader: bun_ast::Loader,\n"),
    ("context::Context::new(file, parsed, source)", "context::Context::new(file, parsed, source, loader.is_typescript())"),
])
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
        args.append("--emit=link")
    elif x in ("--error-format=json",) or x.startswith("--json="):
        continue
    elif x.startswith("--deny=") or x.startswith("--warn=") or x.startswith("--forbid="):
        continue
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
args += ["-C", "link-arg=-Wl,--error-limit=0", "-C", "link-arg=-Wl,--gc-sections", "-C", "link-arg=-lstdc++", "-C", "link-arg=-lpthread", "-C", "link-arg=-ldl", "--cap-lints", "allow"]
env = dict(os.environ)
env.update(unit["env"])
env["CARGO_CRATE_NAME"] = "tsentry"
r = subprocess.run([unit["rustc"]] + args, cwd=WT, env=env)
sys.exit(r.returncode)
