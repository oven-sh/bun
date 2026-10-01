#!/usr/bin/env python3
# Reads the log of a real run of TestSubmodule (go test -v) and prints the two digests that reference.json pins under suiteRun,
# and writes the list of skipped subtests with the reason that Go printed.
# usage: python3 log_reasons.py <test.log> [<out: go-skip-reasons.tsv> [<commit of typescript-go> <go version> <out: suiteRun.json>]]
import collections, hashlib, re, sys

log = open(sys.argv[1], encoding="utf8").read().split("\n")
reasons, status, cur = {}, {}, None
for i, line in enumerate(log):
    m = re.match(r"^=== (RUN|PAUSE|CONT|NAME)\s+TestSubmodule/(.*)$", line)
    if m:
        cur = m.group(2)
        continue
    m = re.match(r"^    compiler_runner\.go:\d+: (.*)$", line)
    if m and cur is not None and "/" not in cur:
        # A line that t.Skipf wrote for an instance; a deeper subtest writes lines of its own.
        assert cur not in reasons, (i, cur)
        reasons[cur] = m.group(1)
        continue
    m = re.match(r"^    --- (PASS|SKIP|FAIL): TestSubmodule/(\S+) \(", line)
    if m and "/" not in m.group(2):
        status[m.group(2)] = m.group(1)
assert {n for n, s in status.items() if s == "SKIP"} == set(reasons)
subtests = "".join(f"{status[n]}\t{n}\n" for n in sorted(status))
skips = "".join(l + "\n" for l in sorted(f"{n}\t{r}" for n, r in reasons.items()))
print("subtests", len(status), dict(collections.Counter(status.values())), "sha256", hashlib.sha256(subtests.encode()).hexdigest())
print("skip reasons", len(reasons), "sha256", hashlib.sha256(skips.encode()).hexdigest())
if len(sys.argv) > 2:
    open(sys.argv[2], "w", encoding="utf8").write(skips)
if len(sys.argv) > 5:
    # The member suiteRun of reference_counts.json: <commit of typescript-go> <go version> <out.json>
    import json
    json.dump({"typescript-go": sys.argv[3], "go": sys.argv[4], "subtests": len(status), "sha256": hashlib.sha256(subtests.encode()).hexdigest(), "skipReasonsSha256": hashlib.sha256(skips.encode()).hexdigest()}, open(sys.argv[5], "w"))
