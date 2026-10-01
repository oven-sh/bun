#!/usr/bin/env python3
"""Links a bun-profile as the release build of the worktree does (the `link` edge of build/release/build.ninja), with the library of
bun_js_parser taken from <scratch>/<what>/lto (build-release-rlib.py). Nothing is written in the worktree: the binary and the linker
map go to <scratch>/<what>/. Every other input is what the release build left. The library of a crate that instantiates a generic
function of the parser itself (Parser::parse_for_lint in the command) keeps the code it was built with: only the parse pass of
Parser::parse is what this binary is for.
usage: /workspace/tools/lk python3 relink.py <what> [/workspace/wt/parser] [/tmp/b4ec]     output: <scratch>/<what>/bun-profile"""
import glob
import os
import re
import subprocess
import sys

what = sys.argv[1]
root = sys.argv[2] if len(sys.argv) > 2 else "/workspace/wt/parser"
scratch = os.path.join(sys.argv[3] if len(sys.argv) > 3 else "/tmp/b4ec", what)
build = os.path.join(root, "build/release")
lines = open(os.path.join(build, "build.ninja"), encoding="utf-8").read().split("\n")
start = next(i for i, line in enumerate(lines) if line.startswith("build bun-profile | "))
edge = []
variables = {}
i = start
while True:
    line = lines[i]
    if i > start and not line.startswith("    ") and not line.startswith("  "):
        break
    m = re.match(r"^  (\w+) = (.*)$", line)
    if m:
        variables[m.group(1)] = m.group(2)
    else:
        edge.append(line.rstrip("$").strip())
    i += 1
text = " ".join(edge)
inputs = text.split(": link ", 1)[1].split(" | ")[0].split(" || ")[0].split()
library = glob.glob(os.path.join(scratch, "lto", "libbun_js_parser-*.rlib"))[0]
replaced = 0
for index, path in enumerate(inputs):
    if re.search(r"/libbun_js_parser-[0-9a-f]+\.rlib$", path):
        inputs[index] = library
        replaced += 1
assert replaced == 1, replaced
rsp = os.path.join(scratch, "bun-profile.rsp")
open(rsp, "w").write("\n".join(inputs) + "\n")
ldflags = variables["ldflags"].replace("$:", ":").split()
ldflags = [("-Wl,-Map=" + os.path.join(scratch, "bun-profile.linker-map")) if flag.startswith("-Wl,-Map=") else flag for flag in ldflags]
command = ["/usr/lib/llvm-23/bin/clang++", "@" + rsp] + variables["lazy"].split() + ldflags + ["-o", os.path.join(scratch, "bun-profile")]
print(len(inputs), "inputs;", library, file=sys.stderr)
sys.exit(subprocess.run(command, cwd=build).returncode)
