# Makes layers-summary.txt and layers-detail.txt from layers.txt (state.sh layers) and the function lists of the runs.
# usage: python3 layers.py <dir with <run>.func.txt, i.e. <work dir>/statecov>
# summary: per run, the K3 layers it enters as <layer>:<functions entered>. detail: the names for layers with at most six.
import os, re, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__))
K = os.path.join(here, "../../../end-to-end-k4-k5/py/k3order.py")
runs = {}
cur = None
for l in open(os.path.join(here, "layers.txt")):
    l = l.rstrip("\n")
    if l.startswith("# "):
        cur = runs.setdefault(l[2:], [])
    else:
        m = re.match(r"^(\d\d) .*?fn=\s*(\d+)", l)
        if m:
            cur.append((m.group(1), int(m.group(2))))
order = [l.split("|")[0].strip() for l in open(os.path.join(here, "runs.txt")) if l.strip() and not l.startswith("#")]
summary, detail = [], []
for n in order:
    r = runs[n]
    summary.append("%-28s last=%s  layers: %s" % (n, r[-1][0], " ".join("%s:%d" % x for x in r)))
    small = [k for k, v in r if v <= 6 and k != "04"]
    if not small:
        continue
    text = subprocess.run(["python3", K, os.path.join(sys.argv[1], n + ".func.txt")] + small, capture_output=True, text=True).stdout
    names = {}
    for l in text.split("\n"):
        m = re.match(r"^\s+(\d\d) (\S+) (\S+) \d+$", l)
        if m:
            names.setdefault(m.group(1), []).append(m.group(3))
    detail.append("# " + n)
    for k in sorted(names):
        detail.append("  %s: %s" % (k, " ".join(names[k])))
open(os.path.join(here, "layers-summary.txt"), "w").write("\n".join(summary) + "\n")
open(os.path.join(here, "layers-detail.txt"), "w").write("\n".join(detail) + "\n")
print(len(summary), "runs")
