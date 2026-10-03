#!/usr/bin/env python3
# Writes the self-review launch script from a backup commit whose tree holds the work and .selfreview/.
# Usage: gen.py <repo> <backup-commit> <out.mjs> [export-expression]
import json, subprocess, sys
repo, commit, out = sys.argv[1:4]
export_expr = sys.argv[4] if len(sys.argv) > 4 else "result"
git = lambda *a: subprocess.run(["git", "-C", repo, *a], capture_output=True, text=True, check=True).stdout
diff = git("diff", "--no-color", "--no-ext-diff", commit + "^", commit, "--", ".", ":(exclude).selfreview")
s = json.loads(git("show", commit + ":.selfreview/strings.json"))
args = {"diff_text": diff, **{k: s[k] for k in ("pr_title", "pr_body", "extra_context", "open_prs", "linked", "env_preamble")}}
src = (
    'import rdr from "robobun:rdr";\n'
    'export const meta = { name: "self-review", phases: ["Disposition", "Survey", "Probe", "Refute", "Steelman", "Synthesize"] };\n'
    "const reviewArgs = " + json.dumps(args, ensure_ascii=False) + ";\n"
    'const result = await rdr({ ...reviewArgs, mode: "pushback", cwd: "/workspace/bun" });\n'
    "export default " + export_expr + ";\n"
)
open(out, "w").write(src)
print(len(diff), "diff bytes,", len(src), "script bytes")
