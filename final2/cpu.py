import os, resource, subprocess, sys, statistics
bins = sys.argv[1].split(',')
script = sys.argv[2]
n = int(sys.argv[3])
res = {b: [] for b in bins}
env = dict(os.environ, NO_COLOR='1')
for i in range(n):
    for b in bins:
        before = resource.getrusage(resource.RUSAGE_CHILDREN)
        subprocess.run([b, script], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
        after = resource.getrusage(resource.RUSAGE_CHILDREN)
        res[b].append(((after.ru_utime - before.ru_utime) + (after.ru_stime - before.ru_stime)) * 1000)
for b in bins:
    v = sorted(res[b])
    print(f"{os.path.basename(b):12s} {os.path.basename(script):14s} cpu ms: median {statistics.median(v):.3f}  p25 {v[len(v)//4]:.3f}  min {v[0]:.3f}  mean {statistics.mean(v):.3f}")
