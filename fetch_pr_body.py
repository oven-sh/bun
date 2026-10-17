# usage: fetch_pr_body.py <pr number> <out file>   (fails when the answer is not a PR body)
import subprocess, sys, json
n, out = sys.argv[1], sys.argv[2]
r = subprocess.run(["gh", "api", "graphql", "-f", "query=query { repository(owner: \"oven-sh\", name: \"bun\") { pullRequest(number: %s) { body } } }" % n], capture_output=True, text=True)
d = json.loads(r.stdout)
body = d["data"]["repository"]["pullRequest"]["body"]
assert body.startswith("### Problem") or body.startswith("Fixes #"), body[:80]
open(out, "w", encoding="utf-8").write(body)
print("fetched", len(body), "bytes")
