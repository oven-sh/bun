#!/usr/bin/env python3
"""Interleaved A/B wall-clock of Bun.Archive#extract: ab.py <runs> <base> <pr> <tar>..."""
import statistics, subprocess, shutil, sys, os
runs = int(sys.argv[1]); base, pr = sys.argv[2:4]; tars = sys.argv[4:]
def one(binary, tar, i):
    dest = os.environ.get("AB_DEST", "/tmp/arc/ab") + "/out-%d" % i
    shutil.rmtree(dest, ignore_errors=True)
    out = subprocess.run([binary, "/tmp/arc/ab/one.mjs", tar, dest], capture_output=True, text=True, check=True).stdout.split()
    shutil.rmtree(dest, ignore_errors=True)
    return int(out[0])
for tar in tars:
    # base twice (A/A) gives the noise floor next to the A/B delta
    samples = {"base": [], "base2": [], "pr": []}
    for i in range(runs):
        for tag, binary in (("base", base), ("pr", pr), ("base2", base)):
            samples[tag].append(one(binary, tar, i))
    med = {k: statistics.median(v) for k, v in samples.items()}
    q = {k: statistics.quantiles(v, n=4) for k, v in samples.items()}
    print("%s runs=%d median_us base=%d base2=%d pr=%d | A/A %+.1f%% | A/B %+.1f%% | IQR base=%d..%d pr=%d..%d" % (
        os.path.basename(tar), runs, med["base"], med["base2"], med["pr"],
        100.0 * (med["base2"] - med["base"]) / med["base"], 100.0 * (med["pr"] - med["base"]) / med["base"],
        q["base"][0], q["base"][2], q["pr"][0], q["pr"][2]), flush=True)
