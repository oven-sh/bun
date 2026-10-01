#!/usr/bin/env python3
"""Compiles a scratch copy of bun_js_parser (<scratch>/<what>/src/js_parser) to the library that the release build links:
the flags that the release build of the worktree recorded for the crate (build/release/rust-target/units/bun_js_parser-*.json),
unchanged but for the path of the source, the directory of the output and the lint levels. relink.py links it into a bun-profile.
usage: /workspace/tools/lk python3 build-release-rlib.py <what> [/workspace/wt/parser] [/tmp/b4ec]     output: <scratch>/<what>/lto/libbun_js_parser-*.rlib"""
import glob
import json
import os
import subprocess
import sys

what = sys.argv[1]
root = sys.argv[2] if len(sys.argv) > 2 else "/workspace/wt/parser"
scratch = os.path.join(sys.argv[3] if len(sys.argv) > 3 else "/tmp/b4ec", what)
unit = json.load(open(glob.glob(os.path.join(root, "build/release/rust-target/units/bun_js_parser-*.json"))[0]))
out_dir = os.path.join(scratch, "lto")
os.makedirs(out_dir, exist_ok=True)
args = []
skip = 0
for index, arg in enumerate(unit["args"]):
    if skip:
        skip -= 1
        continue
    if arg == "src/js_parser/lib.rs":
        args.append(os.path.join(scratch, "src/js_parser/lib.rs"))
    elif arg.startswith("--error-format") or arg.startswith("--json"):
        continue
    elif arg.startswith("--emit"):
        args.append("--emit=metadata,link")
    elif arg == "--out-dir":
        args += ["--out-dir", out_dir]
        skip = 1
    elif arg == "-Z" and unit["args"][index + 1] == "binary-dep-depinfo":
        skip = 1
    else:
        args.append(arg)
args += ["--cap-lints", "allow"]
env = dict(os.environ)
env.update(unit["env"])
library = unit.get("libraryPath")
if library:
    env[library["variable"]] = ":".join(library["prepend"] + [env.get(library["variable"], "")])
result = subprocess.run([unit["rustc"]] + args, cwd=unit["cwd"], env=env)
print(os.listdir(out_dir))
sys.exit(result.returncode)
