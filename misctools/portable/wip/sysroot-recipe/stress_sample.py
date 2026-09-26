#!/usr/bin/env python3
"""
stress_sample.py --bin a=path --bin b=path --dir JSTests/stress --every N --out out.json [--workers 4]
Runs every Nth test file (sorted by name) with every binary and compares exit status and stdout.
A test is run the way run-jsc-stress-tests runs "runDefault" plus FTL on:
   jsc --useDollarVM=true --useFunctionDotArguments=true --maxPerThreadStackUsage=1572864 --useFTLJIT=true [requireOptions] test.js
Files with "//@ skip" (unconditional) are not run.
"""
import argparse, concurrent.futures, json, os, re, subprocess, sys, time

BASE = ["--useDollarVM=true", "--useFunctionDotArguments=true", "--maxPerThreadStackUsage=1572864", "--useFTLJIT=true"]

def directives(path):
    opts = []; skip = False; kind = "default"
    with open(path, errors="replace") as f:
        for i, line in enumerate(f):
            if i > 40: break
            if not line.startswith("//@"): continue
            d = line[3:].strip()
            if re.match(r"^skip\b(?! if)", d): skip = True
            m = re.search(r"requireOptions\((.*)\)", d)
            if m:
                opts += re.findall(r'"([^"]+)"', m.group(1))
            if re.search(r"\brunBytecodeCache|runModules|runWebAssembly|runComplexTest|slow!|crashOK!|runShadowChicken|runProfiler|runNoisyTest", d):
                kind = "special"
    return skip, opts, kind

def run(binary, test, opts, cwd, timeout):
    t0 = time.monotonic()
    try:
        p = subprocess.run([binary] + BASE + opts + [test], cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout,
                           env=dict(os.environ, TZ="UTC", LANG="C"))
        return {"rc": p.returncode, "out": p.stdout.decode("utf-8", "replace")[-2000:], "err": p.stderr.decode("utf-8", "replace")[-1500:], "s": time.monotonic() - t0}
    except subprocess.TimeoutExpired:
        return {"rc": "timeout", "out": "", "err": "", "s": time.monotonic() - t0}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bin", action="append", required=True)
    ap.add_argument("--dir", required=True)
    ap.add_argument("--every", type=int, default=10)
    ap.add_argument("--offset", type=int, default=0)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--timeout", type=int, default=120)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    bins = [b.split("=", 1) for b in a.bin]
    files = sorted(f for f in os.listdir(a.dir) if f.endswith(".js"))
    sample = files[a.offset::a.every]
    jobs = []; skipped = 0; special = 0
    for f in sample:
        skip, opts, kind = directives(os.path.join(a.dir, f))
        if skip: skipped += 1; continue
        if kind == "special": special += 1; continue
        jobs.append((f, opts))
    results = {}
    def work(job):
        f, opts = job
        return f, {label: run(path, f, opts, a.dir, a.timeout) for label, path in bins}
    with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers) as ex:
        for n, (f, r) in enumerate(ex.map(work, jobs)):
            results[f] = r
            if n % 50 == 0: print(n, "/", len(jobs), flush=True)
    labels = [l for l, _ in bins]
    summary = {"dir": a.dir, "files_in_dir": len(files), "sampled": len(sample), "skipped_by_directive": skipped, "special_kind_not_run": special, "run": len(jobs)}
    for l in labels:
        summary["pass_" + l] = sum(1 for r in results.values() if r[l]["rc"] == 0)
        summary["fail_" + l] = sorted(f for f, r in results.items() if r[l]["rc"] != 0)
    ref = labels[0]
    diffs = {}
    for f, r in results.items():
        for l in labels[1:]:
            if r[l]["rc"] != r[ref]["rc"] or r[l]["out"] != r[ref]["out"]:
                diffs.setdefault(f, {})[l] = {"rc": r[l]["rc"], "rc_" + ref: r[ref]["rc"], "out": r[l]["out"][-400:], "out_" + ref: r[ref]["out"][-400:], "err": r[l]["err"][-600:], "err_" + ref: r[ref]["err"][-600:]}
    summary["different_from_" + ref] = diffs
    json.dump({"summary": summary, "results": results}, open(a.out, "w"), indent=1)
    print(json.dumps({k: (v if not isinstance(v, (list, dict)) else (v if len(v) <= 30 else str(len(v)) + " entries")) for k, v in summary.items()}, indent=1)[:6000])

if __name__ == "__main__":
    main()
