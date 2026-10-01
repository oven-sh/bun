#!/usr/bin/env python3
# Builds a test binary of a patched copy of src/js_parser against the rlibs that `cargo test -p bun_js_parser --lib`
# left in the worktree's target directory. One rustc process; nothing is written in the worktree.
# usage: python3 testbin.py <metadata|link> [codegen units]
import glob, json, os, struct, subprocess, sys, time

ROOT = "/workspace/wt/parser"
BUILD = ROOT + "/target/debug/build"
SNAP = "/tmp/b1check"
MODE = sys.argv[1] if len(sys.argv) > 1 else "metadata"
CGU = sys.argv[2] if len(sys.argv) > 2 else "8"
OUT = SNAP + "/out-testbin"
os.makedirs(OUT, exist_ok=True)

# The test unit that has the executable.
units = [d for d in glob.glob(BUILD + "/bun_js_parser/*") if glob.glob(d + "/out/bun_js_parser-*") and os.path.exists(d + "/fingerprint/test-lib-bun_js_parser.json") and any(os.access(f, os.X_OK) and not f.endswith(".d") for f in glob.glob(d + "/out/bun_js_parser-*"))]
assert len(units) == 1, units
fp = json.load(open(units[0] + "/fingerprint/test-lib-bun_js_parser.json"))

# Every unit by the hash that a dependent records for it.
by_hash = {}
for f in glob.glob(BUILD + "/*/*/fingerprint/lib-*"):
    if f.endswith(".json"):
        continue
    by_hash[open(f).read().strip()] = os.path.dirname(os.path.dirname(f))

externs = []
for _, name, _, dep_fp in fp["deps"]:
    key = struct.pack("<Q", dep_fp).hex()
    d = by_hash.get(key)
    if d is None:
        print("no unit for", name, key)
        continue
    libs = glob.glob(d + "/out/lib" + name + "-*.rlib") + glob.glob(d + "/out/lib" + name + "-*.so")
    if len(libs) != 1:
        print("no library for", name, d, libs)
        continue
    externs.append((name, libs[0]))

dbg = json.load(open(glob.glob(ROOT + "/build/debug/rust-target/units/bun_js_parser-*.json")[0]))
args = [
    "--crate-name", "bun_js_parser", "--edition=2024", SNAP + "/src/js_parser/lib.rs", "--test",
    "-C", "opt-level=0", "-C", "debuginfo=0", "-C", "codegen-units=" + CGU,
    "-C", "linker=/usr/lib/llvm-23/bin/clang++", "-C", "link-arg=-fuse-ld=lld", "-C", "link-arg=-Qunused-arguments",
    "-A", "linker_messages", "-A", "warnings", "--out-dir", OUT, "-Z", "embed-metadata=no",
]
if MODE == "metadata":
    args += ["--emit=metadata"]
for name, lib in externs:
    # The rlib of this cargo holds a stub of its metadata: the full metadata is the file beside it.
    rmeta = lib[: lib.rindex(".")] + ".rmeta"
    if lib.endswith(".rlib") and os.path.exists(rmeta):
        args += ["--extern", name + "=" + rmeta]
    args += ["--extern", name + "=" + lib]
for d in sorted(set(os.path.dirname(p) for p in glob.glob(BUILD + "/*/*/out/*.rlib") + glob.glob(BUILD + "/*/*/out/*.so") + glob.glob(BUILD + "/*/*/out/*.rmeta"))):
    args += ["-L", "dependency=" + d]
env = dict(os.environ)
env.update(dbg["env"])
started = time.time()
run = subprocess.run([dbg["rustc"]] + args, cwd=ROOT, env=env, capture_output=True, text=True)
print(MODE, "exit", run.returncode, round(time.time() - started, 1), "s", len(externs), "externs")
print(run.stderr[-12000:])
sys.exit(run.returncode)
