#!/usr/bin/env python3
"""Interleaved A/B runs under a wrapper. usage: ab.py <runs> <cpulist> <mode> <script> <args...> -- name=bin ...
mode: normal | awake (tools/keepawake on the cpulist) | awake2 (tools/keepawake2) | hogs:<count> (count busy threads of normal priority on the cpulist).
Build the tools first: sh tools/build.sh
Prints, per variant, the median over runs of each numeric field and its min..max over runs (the noise floor)."""
import json, os, statistics, subprocess, sys
runs = int(sys.argv[1]); cpus = sys.argv[2]; mode = sys.argv[3]
sep = sys.argv.index('--')
script = sys.argv[4:sep]
variants = [v.split('=', 1) for v in sys.argv[sep + 1:]]
res = {name: [] for name, _ in variants}
tools = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tools')
def wrap(cmd):
    if mode == 'awake': return [os.path.join(tools, 'keepawake'), cpus, '--'] + cmd
    if mode == 'awake2': return [os.path.join(tools, 'keepawake2'), cpus, '--'] + cmd
    if mode.startswith('hogs:'): return [os.path.join(tools, 'hogs'), mode[5:], cpus, '--'] + cmd
    return cmd
for r in range(runs):
    k = r % len(variants)
    for name, binary in variants[k:] + variants[:k]:
        out = subprocess.run(wrap(['taskset', '-c', cpus, binary] + script), capture_output=True, text=True)
        line = [l for l in out.stdout.splitlines() if l.startswith('{')]
        if not line:
            print(f"[{name}] run failed: {out.stderr[-300:]}", file=sys.stderr); continue
        res[name].append(json.loads(line[-1]))
fields = [k for k, v in next(iter(res.values()))[0].items() if isinstance(v, (int, float)) and k not in ('thinkUs', 'chains', 'K', 'threads')]
label = ' '.join(script[1:]) if len(script) > 1 else script[0]
for name, rows in res.items():
    cells = []
    for f in fields:
        xs = [row[f] for row in rows]
        cells.append(f"{f}={statistics.median(xs):g} [{min(xs):g}..{max(xs):g}]")
    print(f"cpus={cpus:5s} {mode:8s} {label:24s} {name:6s} " + '  '.join(cells), flush=True)
