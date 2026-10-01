#!/usr/bin/env python3
# Type-checks a copy of src/lint of the worktree, with rules/no_empty_pattern.rs as it is in the tree, against the
# .rmeta files of the debug build of the worktree. Metadata only: no crate is rebuilt, nothing is linked, and
# nothing is written into the worktree or its build directory.
# First run: every rule module as the tree has it; one that mod.rs declares and the tree does not have is taken
# from the text of the research. Second run, only when the first fails: the five modules that are not committed
# (all but no_empty_pattern) are empty stand-ins with the signatures that linter.rs calls, and dead code is allowed,
# so what is left is no_empty_pattern.rs, its four calls in linter.rs and the committed files.
# usage: python3 check-real.py <scratch dir> [worktree]      CLIPPY=1: clippy-driver with clippy.toml of the worktree
import glob, json, os, re, shutil, subprocess, sys

scratch = os.path.abspath(sys.argv[1])
wt = sys.argv[2] if len(sys.argv) > 2 else "/workspace/wt/cli"
here = os.path.dirname(os.path.abspath(__file__))
research = os.path.join(here, "..", "c3-rule-support-unification", "final", "src-lint", "rules")
clippy = bool(os.environ.get("CLIPPY"))
tool = "clippy-driver" if clippy else "rustc"

snap = os.path.join(scratch, "clippy" if clippy else "rustc", "lint")
shutil.rmtree(os.path.dirname(snap), ignore_errors=True)
shutil.copytree(os.path.join(wt, "src", "lint"), snap)
mine = os.path.join("rules", "no_empty_pattern.rs")
assert open(os.path.join(snap, mine)).read() == open(os.path.join(wt, "src", "lint", mine)).read()

# The calls of linter.rs say what a stand-in has to have.
STAND_INS = {
    "no_compare_neg_zero": "pub(crate) fn e_binary(_: &mut Context<'_, '_>, _: &bun_ast::E::Binary, _: bun_ast::Loc) {}\n",
    "no_debugger": "pub(crate) fn s_debugger(_: &mut Context<'_, '_>, _: bun_ast::Loc) {}\n",
    "no_duplicate_case": "pub(crate) fn s_switch(_: &mut Context<'_, '_>, _: &bun_ast::S::Switch) {}\n",
    "no_sparse_arrays": "pub(crate) fn e_array(_: &mut Context<'_, '_>, _: &bun_ast::E::Array) {}\n",
    "no_unsafe_negation": "pub(crate) fn e_binary(_: &mut Context<'_, '_>, _: &bun_ast::E::Binary) {}\n",
}
declared = re.findall(r"^pub\(crate\) mod (\w+);", open(os.path.join(snap, "rules", "mod.rs")).read(), re.M)
from_research = []
for name in declared:
    path = os.path.join(snap, "rules", name + ".rs")
    if not os.path.exists(path):
        shutil.copy(os.path.join(research, name + ".rs"), path)
        from_research.append(name)
print("rule modules as the tree has them:", ", ".join(n for n in declared if n not in from_research))
print("rule modules from the text of the research:", ", ".join(from_research) or "none")

unit = json.load(open(max(glob.glob(f"{wt}/build/debug/rust-target/units/bun_lint-*.json"), key=os.path.getmtime)))
out = os.path.join(os.path.dirname(snap), "out")
os.makedirs(out, exist_ok=True)
args = []
skip = 0
a = unit["args"]
for i, x in enumerate(a):
    if skip:
        skip -= 1
        continue
    if x == "src/lint/lib.rs":
        args.append(os.path.join(snap, "lib.rs"))
    elif x.startswith("--emit="):
        args.append("--emit=metadata")
    elif x == "--error-format=json" or x.startswith("--json="):
        continue
    elif x == "-C" and a[i + 1].startswith(("metadata=", "extra-filename=", "incremental=")):
        skip = 1
    elif x == "--out-dir":
        args += ["--out-dir", out]
        skip = 1
    elif x == "-Z" and a[i + 1] == "binary-dep-depinfo":
        skip = 1
    elif x.startswith("-Zthreads="):
        args.append("-Zthreads=2")
    else:
        args.append(x)
args.append("--error-format=short")
env = dict(os.environ)
env.update(unit["env"])
driver = unit["rustc"]
if clippy:
    driver = os.path.join(os.path.dirname(unit["rustc"]), "clippy-driver")
    env["CLIPPY_CONF_DIR"] = wt


def run(more):
    r = subprocess.run([driver] + args + more, cwd=wt, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    return r.returncode, r.stdout


def named(text):
    return [l for l in text.split("\n") if "no_empty_pattern" in l]


code, text = run([])
print(f"{tool} --emit=metadata, every module as the tree or the research has it: exit {code}; lines that name no_empty_pattern: {len(named(text))}")
bad = named(text)
if code != 0:
    for l in [l for l in text.split("\n") if re.match(r"^\S+\.rs:\d+:\d+: error", l)][:40]:
        print("  " + l.replace(snap + "/", ""))
    for name, body in STAND_INS.items():
        open(os.path.join(snap, "rules", name + ".rs"), "w").write("use crate::context::Context;\n\n" + body)
    code, text = run(["--allow=dead_code"])
    print(f"{tool} --emit=metadata, stand-ins for {', '.join(STAND_INS)}: exit {code}; lines that name no_empty_pattern: {len(named(text))}")
    bad += named(text)
    if code != 0:
        print(text[-8000:].replace(snap + "/", ""))
for l in bad:
    print("  " + l)
sys.exit(1 if code != 0 or bad else 0)
