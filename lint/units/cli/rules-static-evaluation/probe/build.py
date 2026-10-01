#!/usr/bin/env python3
# Builds the probe binary against the rlibs of the debug build of a worktree (default /workspace/wt/cli).
# usage: python3 build.py [out-binary] [extra rustc args...]     (run it through /workspace/tools/lk)
# It takes the rustc command of the unit bun_lint from build/debug/rust-target/units and changes only what
# a binary needs: crate name, root file, crate type, output, the list of --extern, and the native link inputs.
import glob, json, os, subprocess, sys

WT = os.environ.get("WT", "/workspace/wt/cli")
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/rse/probe"
EXTRA = sys.argv[2:]
RT = f"{WT}/build/debug/rust-target"
DEPS = f"{RT}/x86_64-unknown-linux-gnu/deps"

unit = json.load(open(glob.glob(f"{RT}/units/bun_lint-*.json")[0]))
args = unit["args"]

def rlib(name):
    found = glob.glob(f"{RT}/units/{name}-*.json")
    outs = [json.load(open(f))["output"] for f in found]
    outs = [o for o in outs if o.endswith(".rlib") and "/x86_64-unknown-linux-gnu/" in o]
    assert len(outs) == 1, (name, outs)
    return outs[0]

cmd = [unit["rustc"], "--crate-name", "rseprobe", "--edition=2024", f"{HERE}/src/main.rs", "--crate-type", "bin",
       "--emit=link", "-o", OUT, "-C", "panic=abort", "-C", "debuginfo=1", "-A", "warnings"]
i = args.index("--check-cfg")
skip = 0
rest = args[i:]
j = 0
while j < len(rest):
    a = rest[j]
    if a in ("--out-dir",) or (a == "-C" and rest[j + 1].startswith(("metadata=", "extra-filename=", "incremental="))):
        j += 2
        continue
    if a == "-Z" and rest[j + 1] == "binary-dep-depinfo":
        j += 2
        continue
    if a == "--extern" and rest[j + 1].endswith(".rmeta"):
        cmd += ["--extern", rest[j + 1][:-6] + ".rlib"]
    cmd.append(a)
    j += 1
for name in ["bun_js_parser", "bun_ast", "bun_core", "bun_alloc", "bun_collections", "bstr"]:
    path = rlib(name)
    cmd += ["--extern", f"{name}={path}", "--extern", f"{name}={path[:-5]}.rmeta"]
cmd += [
    "-Z", "embed-metadata=no",
    "-C", f"link-arg={WT}/build/debug/obj/vendor/mimalloc/src/static.c.o",
    "-C", "link-arg=-Wl,--unresolved-symbols=ignore-all",
    "-C", "link-arg=-Wl,--error-limit=0",
]
cmd += EXTRA
env = dict(os.environ)
env.update({k: v for k, v in unit["env"].items() if not k.startswith("CARGO_PKG") and k not in ("CARGO_MANIFEST_DIR", "CARGO_MANIFEST_PATH", "CARGO_CRATE_NAME")})
os.makedirs(os.path.dirname(OUT), exist_ok=True)
print(" ".join(cmd[:12]), "...", file=sys.stderr)
sys.exit(subprocess.call(cmd, cwd=WT, env=env))
