#!/usr/bin/env python3
"""Compiles a scratch copy of bun_js_parser (build-scratch.sh made it: <scratch>/<head|proto>/src/js_parser) to ONE optimized object,
with the flags that the release build of the worktree recorded for the crate (build/release/rust-target/units/bun_js_parser-*.json),
minus the two flags that leave code generation to the linker (-Clinker-plugin-lto, -Cembed-bitcode=yes): the object holds machine code,
so the functions of the two copies can be compared. It is a proxy for the release binary, whose code the linker generates.
usage: /workspace/tools/lk python3 build-release-obj.py <head|proto> [/workspace/wt/parser] [/tmp/b4ec]     output: <scratch>/<what>/rel/bun_js_parser.o"""
import glob
import json
import os
import subprocess
import sys

what = sys.argv[1]
root = sys.argv[2] if len(sys.argv) > 2 else "/workspace/wt/parser"
scratch = os.path.join(sys.argv[3] if len(sys.argv) > 3 else "/tmp/b4ec", what)
unit = json.load(open(glob.glob(os.path.join(root, "build/release/rust-target/units/bun_js_parser-*.json"))[0]))
out_dir = os.path.join(scratch, "rel")
os.makedirs(out_dir, exist_ok=True)
args = []
skip = 0
source = os.path.join(scratch, "src/js_parser/lib.rs")
for index, arg in enumerate(unit["args"]):
    if skip:
        skip -= 1
        continue
    if arg == "src/js_parser/lib.rs":
        args.append(source)
    elif arg.startswith("--error-format") or arg.startswith("--json") or arg.startswith("--emit") or arg in ("-Clinker-plugin-lto", "-Cembed-bitcode=yes"):
        continue
    elif arg in ("--out-dir",):
        skip = 1
    elif arg == "-Z" and unit["args"][index + 1] in ("binary-dep-depinfo", "embed-metadata=no"):
        skip = 1
    elif arg == "-C" and unit["args"][index + 1].startswith("extra-filename"):
        skip = 1
    else:
        args.append(arg)
args += ["--emit=obj", "-o", os.path.join(out_dir, "bun_js_parser.o"), "--cap-lints", "allow"]
env = dict(os.environ)
env.update(unit["env"])
# The path of the manifest is only read by macros that name files beside it.
library = unit.get("libraryPath")
if library:
    env[library["variable"]] = ":".join(library["prepend"] + [env.get(library["variable"], "")])
print(" ".join(args[:12]), "...", file=sys.stderr)
result = subprocess.run([unit["rustc"]] + args, cwd=unit["cwd"], env=env)
sys.exit(result.returncode)
