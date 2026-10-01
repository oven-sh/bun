#!/usr/bin/env python3
# Times a probe on chains of comparisons with NaN: `(x) === NaN === NaN ...` and `x === NaN === NaN ...`.
# usage: python3 chain.py <lintprobe> [links ...]
import os, subprocess, sys, tempfile, time
probe = sys.argv[1]
env = dict(os.environ, ASAN_OPTIONS="detect_leaks=0")
with tempfile.TemporaryDirectory() as d:
    for n in [int(a) for a in sys.argv[2:]] or [4000, 16000]:
        for name, head in (("paren", "(x) === NaN"), ("plain", "x === NaN")):
            path = os.path.join(d, f"{name}.js")
            open(path, "w").write(head + " === NaN" * n + ";\n")
            started = time.time()
            try:
                out = subprocess.run([probe, path], env=env, capture_output=True, timeout=900).stdout
                print(f"{n} links, {name}: {time.time() - started:.2f} s, {out.count(b'use-isnan')} reports", flush=True)
            except subprocess.TimeoutExpired:
                print(f"{n} links, {name}: more than 900 s", flush=True)
