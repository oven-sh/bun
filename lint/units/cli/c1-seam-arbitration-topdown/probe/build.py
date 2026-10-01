#!/usr/bin/env python3
# Compiles src/main.rs with rustc against the rlibs of the debug build of the worktree: no crate is rebuilt.
# usage: python3 build.py [worktree] [out dir]   (run through /workspace/tools/lk)
import glob, json, os, subprocess, sys

wt = sys.argv[1] if len(sys.argv) > 1 else "/workspace/wt/cli"
out = sys.argv[2] if len(sys.argv) > 2 else "/tmp/rsu/out"
here = os.path.dirname(os.path.abspath(__file__))
deps = f"{wt}/build/debug/rust-target/x86_64-unknown-linux-gnu/deps"
unit = json.load(open(glob.glob(f"{wt}/build/debug/rust-target/units/bun_lint-*.json")[0]))
args = []
skip = 0
a = unit["args"]
for i, x in enumerate(a):
    if skip:
        skip -= 1
        continue
    if x == "--crate-name":
        args += ["--crate-name", "lintprobe"]; skip = 1
    elif x == "src/lint/lib.rs":
        args.append(f"{here}/src/main.rs")
    elif x == "--crate-type":
        args += ["--crate-type", "bin"]; skip = 1
    elif x.startswith("--emit="):
        args.append("--emit=link")
    elif x in ("--error-format=json",) or x.startswith("--json="):
        continue
    elif x == "-C" and (a[i + 1].startswith("metadata=") or a[i + 1].startswith("extra-filename=") or a[i + 1].startswith("incremental=")):
        skip = 1
    elif x == "--out-dir":
        args += ["--out-dir", out]; skip = 1
    elif x == "-Z" and a[i + 1] == "binary-dep-depinfo":
        skip = 1
    else:
        args.append(x)
for name in ["bun_ast", "bun_js_parser", "bun_core", "bun_alloc", "bun_collections", "bstr"]:
    rlib = glob.glob(f"{deps}/lib{name}-*.rlib")
    assert len(rlib) == 1, (name, rlib)
    args += ["--extern", f"{name}={rlib[0]}", "--extern", f"{name}={rlib[0][:-5]}.rmeta"]
# std and friends are linked from the same directory: the .rmeta externs of the unit become .rlib ones.
fixed = []
for x in args:
    if x.startswith("noprelude,nounused:") and x.endswith(".rmeta"):
        fixed.append(x[:-6] + ".rlib")
        fixed.append("--extern"); fixed.append(x)
    else:
        fixed.append(x)
args = fixed
objs = [f"{wt}/build/debug/obj/vendor/mimalloc/src/static.c.o", f"{out}/../highway_strings.o"] + sorted(glob.glob(f"{wt}/build/debug/obj/vendor/highway/hwy/*.o"))
for o in objs:
    args += ["-C", f"link-arg={o}"]
args += ["-C", "link-arg=-Wl,--error-limit=0", "-C", "link-arg=-Wl,--gc-sections", "-C", "link-arg=-lstdc++", "-C", "link-arg=-lpthread", "-C", "link-arg=-ldl"]
env = dict(os.environ)
env.update(unit["env"])
env["CARGO_CRATE_NAME"] = "lintprobe"
os.makedirs(out, exist_ok=True)
r = subprocess.run([unit["rustc"]] + args, cwd=wt, env=env)
sys.exit(r.returncode)
