#!/usr/bin/env python3
"""drive.py <cases_dir> <base_bin> <pr_bin> [--user nobody]

For every case and for mode in (default, glob): set up a scratch dir, run the extractor
with each binary, and print the cases where (result, tree) differ. Also runs each case a
second time into the same destination (re-extraction) and compares that too.
"""
import json, os, shutil, signal, subprocess, sys, tempfile

cases_dir, base_bin, pr_bin = sys.argv[1:4]
user = sys.argv[sys.argv.index("--user") + 1] if "--user" in sys.argv else None
RUN = os.path.join(os.path.dirname(os.path.abspath(__file__)), "run.mjs")
TIMEOUT = 30
WORK = tempfile.mkdtemp(prefix="diffwork-", dir="/tmp")
os.chmod(WORK, 0o777)

def as_user(cmd):
    return ["setpriv", "--reuid=" + user, "--regid=nogroup", "--clear-groups"] + cmd if user else cmd

def sh(cmd, cwd):
    proc = subprocess.Popen(as_user(cmd), cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                            start_new_session=True,
                            env={**os.environ, "BUN_DEBUG_QUIET_LOGS": "1", "HOME": "/tmp/nobody-home",
                                 "BUN_RUNTIME_TRANSPILER_CACHE_PATH": "0"})
    try:
        out, err = proc.communicate(timeout=TIMEOUT)
    except subprocess.TimeoutExpired:
        # Root has no CAP_KILL here: the signal has to come from the owner of the process.
        subprocess.run(as_user(["kill", "-9", "--", "-%d" % proc.pid]), capture_output=True)
        try:
            proc.communicate(timeout=20)
        except subprocess.TimeoutExpired:
            pass
        return subprocess.CompletedProcess(cmd, 124, stdout='{"result": "TIMEOUT", "tree": []}\n', stderr="")
    return subprocess.CompletedProcess(cmd, proc.returncode, stdout=out, stderr=err)

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
            print("=" * 8, case, mode, "(EXPECTED: pre-existing symlink)" if case.startswith("XPRE") else "", flush=True)
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
