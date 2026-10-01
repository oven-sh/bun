#!/usr/bin/env python3
# Type-checks one file with the rustc arguments of the crate bun_runtime of the debug build (metadata only, nothing is linked or rebuilt).
# usage: python3 check.py <file.rs> <out dir> [worktree]
import glob, json, os, subprocess, sys
src, out = sys.argv[1], sys.argv[2]
wt = sys.argv[3] if len(sys.argv) > 3 else "/workspace/wt/cli"
unit = json.load(open(glob.glob(f"{wt}/build/debug/rust-target/units/bun_runtime-*.json")[0]))
a = unit["args"]
args, skip = [], 0
for i, x in enumerate(a):
    if skip:
        skip -= 1
        continue
    if x == "--crate-name":
        args += ["--crate-name", "lintcheck"]; skip = 1
    elif x == "src/runtime/lib.rs":
        args.append(src)
    elif x.startswith("--emit="):
        args.append("--emit=metadata")
    elif x == "--error-format=json" or x.startswith("--json="):
        continue
    elif x == "-C" and (a[i + 1].startswith("metadata=") or a[i + 1].startswith("extra-filename=") or a[i + 1].startswith("incremental=")):
        skip = 1
    elif x == "--out-dir":
        args += ["--out-dir", out]; skip = 1
    elif x == "-Z" and a[i + 1] == "binary-dep-depinfo":
        skip = 1
    else:
        args.append(x)
env = dict(os.environ); env.update(unit["env"]); env["CARGO_CRATE_NAME"] = "lintcheck"
os.makedirs(out, exist_ok=True)
sys.exit(subprocess.run([unit["rustc"]] + args, cwd=wt, env=env).returncode)
