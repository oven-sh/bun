#!/usr/bin/env python3
# SCRATCH of the research unit "ts-entry-codes-harness" (top-down pass), not part of the change. The planned text is in ../planned/.
# One run, through /workspace/tools/lk: checks the planned text of D2 under the lint levels of the workspace and builds a probe of it.
#   A   rustc, a copy of src/lint with the planned edits, as the library bun_lint (the arguments of the real unit)
#   A2  the same with --test, metadata only: the tests compile, the new one among them
#   B   clippy-driver over A and A2 with clippy.toml of the worktree
#   C   rustc and clippy-driver over planned_cmd.rs (the planned `parse` of lint_command.rs) against the library of A
#   D   the probe binary: the same sources and planned_cmd.rs as one binary (lints capped), for the runs
# usage: /workspace/tools/lk python3 make2.py [out dir]     default /tmp/td-probe/out3
import glob, json, os, shutil, subprocess, sys

WT = os.environ.get("WT", "/workspace/wt/cli")
HERE = os.path.dirname(os.path.abspath(__file__))
PLANNED = os.path.join(HERE, "..", "planned")
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/td-probe/out3"
SRC = f"{OUT}/src"
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(OUT)
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
    ("    parsed: &ParsedOnly<'_, 'a>,\n    source: &'a bun_ast::Source,\n    arena: &'a bun_alloc::Arena,\n) -> Vec<Diagnostic> {\n    linter::run(\n        context::Context::new(file, parsed, source, arena),\n        parsed.stmts,\n    )\n}",
     "    parsed: &ParsedForLint<'_, 'a>,\n    source: &'a bun_ast::Source,\n) -> Vec<Diagnostic> {\n    linter::run(context::Context::new(file, parsed, source), parsed.stmts)\n}"),
])
edit("context.rs", [
    ("use bun_js_parser::parse::parse_entry::ParsedOnly;", "use bun_js_parser::parse::parse_entry::ParsedForLint;"),
    ("    parsed: &'p ParsedOnly<'p, 'a>,\n    source: &'a Source,\n    arena: &'a bun_alloc::Arena,\n    pub(crate) stack_check", "    parsed: &'p ParsedForLint<'p, 'a>,\n    source: &'a Source,\n    arena: &'a bun_alloc::Arena,\n    pub(crate) stack_check"),
    ("        parsed: &'p ParsedOnly<'p, 'a>,\n        source: &'a Source,\n        arena: &'a bun_alloc::Arena,\n    ) -> Self {\n        Context {\n            file,\n            parsed,\n            source,\n            arena,\n",
     "        parsed: &'p ParsedForLint<'p, 'a>,\n        source: &'a Source,\n    ) -> Self {\n        Context {\n            file,\n            parsed,\n            source,\n            arena: parsed.arena,\n"),
])
edit("diagnostic.rs", [
    ("use std::sync::OnceLock;\n", "use std::sync::OnceLock;\n\nuse bun_js_parser::parse::syntax_errors::SyntaxError;\n"),
    ("        diagnostic.related = related;\n        Some(diagnostic)\n    }\n", "        diagnostic.related = related;\n        Some(diagnostic)\n    }\n" + open(f"{PLANNED}/from_syntax_error.rs.txt").read()),
])
edit("tests.rs", [
    ("use bun_core::BStr;\n", "use bun_core::BStr;\nuse bun_js_parser::parse::syntax_errors::SyntaxError;\n"),
])
open(f"{SRC}/tests.rs", "a").write(open(f"{PLANNED}/new_test.rs.txt").read())
shutil.copy(f"{PLANNED}/planned_cmd.rs", f"{SRC}/planned_cmd.rs")

deps = f"{WT}/build/debug/rust-target/x86_64-unknown-linux-gnu/deps"
unit = json.load(open(glob.glob(f"{WT}/build/debug/rust-target/units/bun_lint-*.json")[0]))
env = dict(os.environ)
env.update(unit["env"])
rustc = unit["rustc"]
clippy = os.path.join(os.path.dirname(rustc), "clippy-driver")

def base(crate, root, out, emit, keep_lints=True, crate_type="lib"):
    args, skip, a = [], 0, unit["args"]
    for i, x in enumerate(a):
        if skip:
            skip -= 1
            continue
        if x == "--crate-name":
            args += ["--crate-name", crate]; skip = 1
        elif x == "src/lint/lib.rs":
            args.append(root)
        elif x == "--crate-type":
            args += ["--crate-type", crate_type]; skip = 1
        elif x.startswith("--emit="):
            args.append(f"--emit={emit}")
        elif x in ("--error-format=json",) or x.startswith("--json="):
            continue
        elif not keep_lints and (x.startswith("--deny=") or x.startswith("--warn=") or x.startswith("--forbid=")):
            continue
        elif x == "-C" and (a[i + 1].startswith("metadata=") or a[i + 1].startswith("extra-filename=") or a[i + 1].startswith("incremental=")):
            skip = 1
        elif x == "--out-dir":
            args += ["--out-dir", out]; skip = 1
        elif x == "-Z" and a[i + 1] == "binary-dep-depinfo":
            skip = 1
        else:
            args.append(x)
    os.makedirs(out, exist_ok=True)
    return args

def run(step, driver, args, extra_env=None):
    e = dict(env)
    if extra_env:
        e.update(extra_env)
    r = subprocess.run([driver] + args, cwd=WT, env=e, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    tail = r.stdout.strip()
    print(f"== {step}: exit {r.returncode}" + (f"\n{tail[-6000:]}" if tail else ""), flush=True)
    return r.returncode

rc = 0
conf = {"CLIPPY_CONF_DIR": WT}
# A, A2, B: the library, its tests, clippy over both
lib = base("bun_lint", f"{SRC}/lib.rs", f"{OUT}/lib", "metadata,link") + ["-C", "metadata=td", "-C", "extra-filename=-td"]
rc |= run("A rustc lib bun_lint (planned edits, lint levels of the workspace)", rustc, lib)
rc |= run("B clippy lib", clippy, base("bun_lint", f"{SRC}/lib.rs", f"{OUT}/clippy", "metadata"), conf)
# C: the planned `parse` as a crate that uses the library of A
cmd = lambda out: base("planned_cmd", f"{PLANNED}/planned_cmd.rs", out, "metadata") + ["--extern", f"bun_lint={OUT}/lib/libbun_lint-td.rmeta"]
rc |= run("C rustc planned_cmd (the planned parse of lint_command.rs)", rustc, cmd(f"{OUT}/cmd"))
rc |= run("C clippy planned_cmd", clippy, cmd(f"{OUT}/cmdclippy"), conf)
# D: the probe binary
text = open(f"{SRC}/lib.rs").read()
assert text.count("#[cfg(test)]\nmod tests;") == 1
text = text.replace("#[cfg(test)]\nmod tests;", "pub(crate) mod tests;")
tests = open(f"{SRC}/tests.rs").read().replace("#[test]\n", "")
assert tests.count("fn a_syntax_error_is_what_the_reference_reports()") == 1
tests = tests.replace("fn a_syntax_error_is_what_the_reference_reports()", "pub(crate) fn a_syntax_error_is_what_the_reference_reports()")
tests = tests.replace("fn a_message_of_the_log_becomes_a_diagnostic()", "pub(crate) fn a_message_of_the_log_becomes_a_diagnostic()")
open(f"{SRC}/tests.rs", "w").write(tests)
text += '''
extern crate self as bun_lint;
#[path = "%s/src/js_parser/native_test_shims.rs"]
mod native_test_shims;
#[allow(non_snake_case)]
mod Macro {
    pub use bun_js_parser::Macro::MacroRemapEntry;
}
#[path = "/workspace/notes/lint/units/cli/d1-rust-tests-topdown/later/dtoa.rs"]
mod dtoa;
mod planned_cmd;
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
''' % WT
open(f"{SRC}/main.rs", "w").write(text)
shutil.copy(f"{HERE}/probe_main.rs", f"{SRC}/probe_main.rs")
args = base("tsentry", f"{SRC}/main.rs", OUT, "link", keep_lints=False, crate_type="bin")
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
args = fixed + ["-C", "link-arg=-Wl,--error-limit=0", "-C", "link-arg=-Wl,--gc-sections", "-C", "link-arg=-lstdc++", "-C", "link-arg=-lpthread", "-C", "link-arg=-ldl", "--cap-lints", "allow"]
e = dict(env); e["CARGO_CRATE_NAME"] = "tsentry"
r = subprocess.run([rustc] + args, cwd=WT, env=e, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
print(f"== D probe binary: exit {r.returncode}\n{r.stdout.strip()[-3000:]}", flush=True)
sys.exit(rc | r.returncode)
