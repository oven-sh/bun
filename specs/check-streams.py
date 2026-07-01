#!/usr/bin/env python3
"""Fast, build-system-free syntax/type check for the new Web Streams C++.

Reuses the EXACT clang flags the real build uses for a neighboring WebCore TU
(taken from build/debug/compile_commands.json), so `-I` paths, `-D`s, -std,
sanitizers, and the prebuilt-WebKit include dir are all correct. It does NOT
build anything, does NOT touch the build system, and finishes in seconds.

  python3 specs/check-streams.py                 # syntax-check every streams/*.h
  python3 specs/check-streams.py path/to/File.cpp  [more.cpp ...]
                                                 # syntax-check specific TU(s)

Exit 0 = clean. Nonzero = errors were printed. Warnings are suppressed on the
header probe (that is the old code's business); NOT suppressed for .cpp args.

Phase-B .cpp authors: run `python3 specs/check-streams.py <your file>.cpp`
before declaring yourself done. Zero errors is a hard requirement.
"""
import glob
import json
import os
import shlex
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "build/debug/compile_commands.json")
REFERENCE_TU = "webcore/JSCookie.cpp"  # any always-present hand-written WebCore TU


def reference_flags():
    with open(DB) as f:
        db = json.load(f)
    entry = next(e for e in db if e["file"].endswith(REFERENCE_TU))
    args = shlex.split(entry.get("command") or " ".join(entry["arguments"]))
    out, skip = [], False
    for a in args[1:]:
        if skip:
            skip = False
            continue
        if a in ("-o", "-MF", "-MT"):
            skip = True
            continue
        if a == "-c" or a.endswith((".cpp", ".o")):
            continue
        out.append(a)
    return args[0], out, entry["directory"]


def run(clangxx, flags, directory, tu, extra):
    p = subprocess.run(
        [clangxx, *flags, "-fsyntax-only", "-fno-diagnostics-color", "-ferror-limit=200", *extra, tu],
        cwd=directory, capture_output=True, text=True,
    )
    # Show only errors + their notes; the vendored/old headers emit unrelated warnings.
    lines, keep = p.stderr.splitlines(), []
    for i, line in enumerate(lines):
        if ": error:" in line or "error:" in line and "generated" not in line:
            keep.append(line)
            for j in (i + 1, i + 2):
                if j < len(lines) and (": note:" in lines[j] or lines[j].startswith(("  ", "\t"))):
                    keep.append(lines[j])
    return p.returncode, "\n".join(keep)


def main() -> int:
    clangxx, flags, directory = reference_flags()
    targets = sys.argv[1:]
    if not targets:
        headers = sorted(glob.glob(os.path.join(ROOT, "src/jsc/bindings/webcore/streams/*.h")))
        probe = "/tmp/streams_header_probe.cpp"
        with open(probe, "w") as f:
            f.write("".join(f'#include "{h}"\n' for h in headers))
            f.write("int main() { return 0; }\n")
        code, err = run(clangxx, flags, directory, probe, ["-Wno-everything"])
        print(f"[check-streams] {len(headers)} headers -> {'CLEAN' if code == 0 else 'ERRORS'}")
        if err:
            print(err)
        return code
    worst = 0
    for tu in targets:
        tu = os.path.abspath(tu)
        code, err = run(clangxx, flags, directory, tu, [])
        print(f"[check-streams] {os.path.relpath(tu, ROOT)} -> {'CLEAN' if code == 0 else 'ERRORS'}")
        if err:
            print(err)
        worst = worst or code
    return worst


if __name__ == "__main__":
    sys.exit(main())
