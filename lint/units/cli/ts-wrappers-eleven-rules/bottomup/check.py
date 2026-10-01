#!/usr/bin/env python3
# SCRATCH: type-checks src/lint with the overlay as the crate bun_lint itself (a library, the lint levels of the workspace kept),
# against the rlibs of the debug build of the worktree. What is for the probe alone (the walk of the erased statements behind an
# environment variable) is taken out first. usage: /workspace/tools/lk python3 check.py [out dir]
import glob, json, os, shutil, subprocess, sys
WT = os.environ.get("WT", "/workspace/wt/cli")
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/tsw/check"
SRC = f"{OUT}/src"
shutil.rmtree(SRC, ignore_errors=True)
shutil.copytree(f"{WT}/src/lint", SRC, ignore=shutil.ignore_patterns("Cargo.toml", "LICENSE*", "UPSTREAM*"))
for root, _, files in os.walk(f"{HERE}/overlay"):
    for name in files:
        rel = os.path.relpath(os.path.join(root, name), f"{HERE}/overlay")
        shutil.copy(os.path.join(root, name), f"{SRC}/{rel}")
def edit(name, pairs):
    path = f"{SRC}/{name}"
    text = open(path).read()
    for old, new in pairs:
        assert text.count(old) == 1, (name, old, text.count(old))
        text = text.replace(old, new)
    open(path, "w").write(text)
def cut(name, start, end):
    path = f"{SRC}/{name}"
    text = open(path).read()
    a = text.index(start); b = text.index(end, a)
    open(path, "w").write(text[:a] + text[b:])
edit("lib.rs", [
    ("use bun_js_parser::parse::parse_entry::ParsedOnly;", "use bun_js_parser::parse::parse_entry::ParsedForLint;"),
    ("    parsed: &ParsedOnly<'_, 'a>,\n    source: &'a bun_ast::Source,\n    arena: &'a bun_alloc::Arena,\n", "    parsed: &ParsedForLint<'_, 'a>,\n    source: &'a bun_ast::Source,\n    loader: bun_ast::Loader,\n"),
    ("context::Context::new(file, parsed, source, arena)", "context::Context::new(file, parsed, source, loader.is_typescript())"),
])
cut("linter.rs", '    if std::env::var_os("PROBE_WALK_ERASED").is_some() {', "    linter.context.finish()")
cut("context.rs", "    /// The statements and the members that the tree leaves out and the parse pass built: a walk of them reaches what they hold.", "    /// The walk stops going deeper at `loc`. Said once.")
unit = json.load(open(glob.glob(f"{WT}/build/debug/rust-target/units/bun_lint-*.json")[0]))
args = []
skip = 0
a = unit["args"]
for i, x in enumerate(a):
    if skip:
        skip -= 1
        continue
    if x == "src/lint/lib.rs":
        args.append(f"{SRC}/lib.rs")
    elif x.startswith("--emit="):
        args.append("--emit=metadata")
    elif x in ("--error-format=json",) or x.startswith("--json="):
        continue
    elif x == "-C" and (a[i + 1].startswith("incremental=")):
        skip = 1
    elif x == "--out-dir":
        args += ["--out-dir", OUT]; skip = 1
    elif x == "-Z" and a[i + 1] == "binary-dep-depinfo":
        skip = 1
    else:
        args.append(x)
env = dict(os.environ)
env.update(unit["env"])
r = subprocess.run([unit["rustc"]] + args, cwd=WT, env=env)
sys.exit(r.returncode)
