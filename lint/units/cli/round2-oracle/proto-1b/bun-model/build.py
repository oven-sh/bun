#!/usr/bin/env python3
# Scratch: compiles src/main.rs with rustc against the rlibs of the debug build of the worktree (no crate is rebuilt).
import glob, json, os, subprocess, sys
wt = "/workspace/wt/cli"
out = os.environ.get("OUT", "/tmp/lint-bun-model/out")
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
        args += ["--crate-name", "tsprobe"]; skip = 1
    elif x == "src/lint/lib.rs":
        args.append(f"{here}/main.rs")
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
        args += ["--out-dir", out]; skip = 1
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
env["CARGO_CRATE_NAME"] = "tsprobe"
os.makedirs(out, exist_ok=True)
print(" ".join(args)[:400], file=sys.stderr)
r = subprocess.run([unit["rustc"]] + args, cwd=wt, env=env)
sys.exit(r.returncode)
