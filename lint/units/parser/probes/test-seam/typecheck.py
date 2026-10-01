#!/usr/bin/env python3
# Type-checks bun_js_parser at HEAD with its test modules, without cargo and without a test harness:
# rustc --emit=metadata with the arguments that the debug build recorded for each crate, on a copy of the sources
# where every `#[test]` line is removed, with `--cfg test`. Nothing is written in the worktree.
# usage: python3 typecheck.py [/workspace/wt/parser] [/tmp/seam-typecheck]     (after one `bun bd --version`)
import glob, json, os, re, subprocess, sys, time

ROOT = sys.argv[1] if len(sys.argv) > 1 else "/workspace/wt/parser"
SNAP = sys.argv[2] if len(sys.argv) > 2 else "/tmp/seam-typecheck"
OUT = SNAP + "/out"
os.makedirs(OUT, exist_ok=True)
subprocess.run(f"git -C {ROOT} archive HEAD src/ast src/js_parser | tar -x -C {SNAP}", shell=True, check=True)
for path in glob.glob(SNAP + "/src/js_parser/**/*.rs", recursive=True):
    text = open(path).read()
    stripped = re.sub(r"(?m)^\s*#\[test\]\s*$", "", text)
    if stripped != text:
        open(path, "w").write(stripped)

units = {}
for path in glob.glob(ROOT + "/build/debug/rust-target/units/*.json"):
    units[os.path.basename(path)[:-5]] = json.load(open(path))


def unit(name):
    keys = [k for k in units if k.rsplit("-", 1)[0] == name and units[k]["kind"] == "lib"]
    assert len(keys) == 1, (name, keys)
    return units[keys[0]]


new = {}


def check(name, root_from=None, root_to=None, extra=()):
    u = unit(name)
    args, out, i = list(u["args"]), [], 0
    while i < len(args):
        a = args[i]
        if root_from and a == root_from:
            out.append(root_to)
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
        elif a == "--extern":
            spec = args[i + 1]
            if "=" in spec:
                key, _ = spec.split("=", 1)
                if key.split(":")[-1] in new:
                    spec = key + "=" + new[key.split(":")[-1]]
            out += [a, spec]
            i += 1
        else:
            out.append(a)
        i += 1
    out += ["-L", "dependency=" + OUT] + list(extra)
    env = dict(os.environ)
    env.update(u["env"])
    started = time.time()
    run = subprocess.run([u["rustc"]] + out, cwd=u["cwd"], env=env, capture_output=True, text=True)
    print(name, "exit", run.returncode, round(time.time() - started, 1), "s")
    if run.returncode == 0:
        new[name] = os.path.join(OUT, os.path.basename(u["rmeta"]))
    else:
        print(run.stderr[-20000:])
        sys.exit(1)


# bun_ast changed since the debug build, so what depends on it between it and the parser is checked again.
check("bun_ast", "src/ast/lib.rs", SNAP + "/src/ast/lib.rs")
for name in ["bun_install_types", "bun_options_types", "bun_react_compiler"]:
    check(name)
check("bun_js_parser", "src/js_parser/lib.rs", SNAP + "/src/js_parser/lib.rs", ["--cfg", "test", "-A", "dead_code"])
