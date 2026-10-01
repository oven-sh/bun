#!/usr/bin/env python3
# Type-checks a patched copy of src/js_parser against the dependency metadata of the debug build of the worktree.
# rustc --emit=metadata with the arguments that the build recorded; nothing is written in the worktree.
# usage: python3 typecheck.py <lib|test>
import glob, json, os, re, subprocess, sys, time, shutil

ROOT = "/workspace/wt/parser"
SNAP = "/tmp/b1check"
MODE = sys.argv[1] if len(sys.argv) > 1 else "lib"
OUT = SNAP + "/out-" + MODE
os.makedirs(OUT, exist_ok=True)
SRC = SNAP + "/src/js_parser"
if MODE == "test":
    # The debug build has its own std, which the test harness does not take: the attribute goes, the functions stay.
    dst = SNAP + "/src-test/js_parser"
    shutil.rmtree(SNAP + "/src-test", ignore_errors=True)
    shutil.copytree(SRC, dst)
    for path in glob.glob(dst + "/**/*.rs", recursive=True):
        text = open(path).read()
        stripped = re.sub(r"(?m)^\s*#\[test\]\s*$", "", text)
        if stripped != text:
            open(path, "w").write(stripped)
    SRC = dst

keys = glob.glob(ROOT + "/build/debug/rust-target/units/bun_js_parser-*.json")
assert len(keys) == 1, keys
u = json.load(open(keys[0]))
args, out, i = list(u["args"]), [], 0
while i < len(args):
    a = args[i]
    if a == "src/js_parser/lib.rs":
        out.append(SRC + "/lib.rs")
    elif a.startswith("--emit="):
        out.append("--emit=metadata")
    elif a == "--out-dir":
        out += ["--out-dir", OUT]
        i += 1
    elif a == "-C" and args[i + 1].startswith("incremental="):
        i += 1
    elif a.startswith("--error-format=") or a.startswith("--json="):
        pass
    elif a == "-Z" and args[i + 1] == "binary-dep-depinfo":
        i += 1
    else:
        out.append(a)
    i += 1
if MODE == "test":
    out += ["--cfg", "test", "-A", "dead_code"]
env = dict(os.environ)
env.update(u["env"])
started = time.time()
run = subprocess.run([u["rustc"]] + out, cwd=u["cwd"], env=env, capture_output=True, text=True)
print(MODE, "exit", run.returncode, round(time.time() - started, 1), "s")
print(run.stderr[-30000:])
sys.exit(run.returncode)
