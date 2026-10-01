#!/usr/bin/env python3
"""drive.py <cases_dir> <base_bin> <pr_bin> [--user nobody]

For every case and for mode in (default, glob): set up a scratch dir, run the extractor
with each binary, and print the cases where (result, tree) differ. Also runs each case a
second time into the same destination (re-extraction) and compares that too.
"""
import json, os, shutil, subprocess, sys, tempfile

cases_dir, base_bin, pr_bin = sys.argv[1:4]
user = sys.argv[sys.argv.index("--user") + 1] if "--user" in sys.argv else None
RUN = os.path.join(os.path.dirname(os.path.abspath(__file__)), "run.mjs")
WORK = tempfile.mkdtemp(prefix="diffwork-", dir="/tmp")
os.chmod(WORK, 0o777)

def sh(cmd, cwd):
    if user:
        cmd = ["su", user, "-s", "/bin/sh", "-c", "cd %s && %s" % (cwd, " ".join("'%s'" % c for c in cmd))]
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=300,
                          env={**os.environ, "BUN_DEBUG_QUIET_LOGS": "1", "HOME": "/tmp/nobody-home",
                               "BUN_RUNTIME_TRANSPILER_CACHE_PATH": "0"})

def fix_perms(path):
    subprocess.run(["chmod", "-R", "u+rwx", path], capture_output=True)

def one(case, binary, mode, tag):
    scratch = os.path.join(WORK, "%s-%s-%s" % (case, mode, tag))
    os.makedirs(scratch)
    os.chmod(scratch, 0o777)
    setup = os.path.join(cases_dir, case, "setup.sh")
    if os.path.exists(setup):
        r = sh(["sh", setup], scratch)
        if r.returncode != 0:
            return ["SETUP FAILED " + r.stderr.strip()[:200]]
    outs = []
    for attempt in (1, 2):
        r = sh([binary, RUN, os.path.join(cases_dir, case), scratch, mode], scratch)
        line = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ""
        try:
            outs.append(json.loads(line))
        except Exception:
            outs.append({"result": "CRASH rc=%s %s" % (r.returncode, r.stderr.strip()[-300:]), "tree": []})
    if not user:
        fix_perms(scratch)
    else:
        sh(["chmod", "-R", "u+rwx", scratch], WORK)
    return outs

diffs = 0
total = 0
for case in sorted(os.listdir(cases_dir)):
    for mode in ("default", "glob"):
        total += 1
        a = one(case, base_bin, mode, "base")
        b = one(case, pr_bin, mode, "pr")
        if a != b:
            diffs += 1
            print("=" * 8, case, mode, "(EXPECTED: pre-existing symlink)" if case.startswith("XPRE") else "")
            for attempt, (x, y) in enumerate(zip(a, b), 1):
                if x == y:
                    print("  run %d: same (%s)" % (attempt, x.get("result") if isinstance(x, dict) else x))
                    continue
                if not isinstance(x, dict) or not isinstance(y, dict):
                    print("  run %d: base=%r pr=%r" % (attempt, x, y)); continue
                print("  run %d: base %s | pr %s" % (attempt, x["result"], y["result"]))
                sx, sy = set(x["tree"]), set(y["tree"])
                for l in sorted(sx - sy): print("     base only:", l[:150])
                for l in sorted(sy - sx): print("     pr only:  ", l[:150])
print("compared %d case/mode pairs as %s, %d differ" % (total, user or "root", diffs))
shutil.rmtree(WORK, ignore_errors=True)
