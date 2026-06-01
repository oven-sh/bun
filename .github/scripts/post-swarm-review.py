#!/usr/bin/env python3
"""Post one synthesized PR review (agent comment body + inline line comments).

Reads the structured synthesis (synthesized/review.json) and the PR diff
(review-input/pr.diff), filters findings to lines that are actually in the diff,
deletes prior swarm inline comments, and posts a single COMMENT review via the
GitHub Reviews API. Falls back to a body-only review if the inline payload is
rejected. Read-only everywhere except this one POST.

Env: REPO (owner/repo), PR (number), HEAD_SHA, GH_TOKEN (for gh).
"""
import json, os, re, subprocess, sys

REPO = os.environ["REPO"]
PR = os.environ["PR"]
HEAD = os.environ["HEAD_SHA"]
MARKER = "<!-- bun-ai-review-swarm -->"
BUDGET = 8
SEV_RANK = {"blocker": 0, "high": 1, "medium": 2, "low": 3}


def gh(args, stdin=None):
    return subprocess.run(["gh", "api"] + args, input=stdin, capture_output=True, text=True)


def valid_diff_lines(path_diff):
    """(path, new_line) pairs that are added/context lines in the diff (RIGHT side)."""
    valid, path, newline = set(), None, None
    try:
        f = open(path_diff, encoding="utf-8", errors="replace")
    except OSError:
        return valid
    for raw in f:
        line = raw.rstrip("\n")
        if line.startswith("+++ b/"):
            path, newline = line[6:], None
        elif line.startswith("@@"):
            m = re.search(r"\+(\d+)", line)
            newline = int(m.group(1)) if m else None
        elif path is not None and newline is not None:
            if line.startswith("+"):
                valid.add((path, newline)); newline += 1
            elif line.startswith(" "):
                valid.add((path, newline)); newline += 1
            # '-' lines and '\' lines do not advance the new-file counter
    return valid


def load_findings():
    try:
        data = json.load(open("synthesized/review.json", encoding="utf-8"))
    except Exception:
        body = ""
        if os.path.exists("synthesized/review-summary.md"):
            body = open("synthesized/review-summary.md", encoding="utf-8", errors="replace").read()
        return {"summary": body or "_Synthesis was not valid JSON; see artifacts._", "findings": [], "recommendation": ""}
    data.setdefault("summary", "")
    data.setdefault("findings", [])
    data.setdefault("recommendation", "")
    return data


def inline_eligible(f, valid):
    sev = (f.get("severity") or "").lower()
    conf = (f.get("confidence") or "high").lower()
    try:
        line = int(f.get("line"))
    except (TypeError, ValueError):
        return False
    return sev in ("blocker", "high") and conf == "high" and (f.get("path"), line) in valid


def main():
    valid = valid_diff_lines("review-input/pr.diff")
    data = load_findings()
    findings = data["findings"] if isinstance(data["findings"], list) else []

    inline = sorted([f for f in findings if inline_eligible(f, valid)],
                    key=lambda f: SEV_RANK.get((f.get("severity") or "").lower(), 9))[:BUDGET]
    inline_ids = {id(f) for f in inline}
    overflow = [f for f in findings if id(f) not in inline_ids]

    # Delete prior swarm inline review comments so re-runs don't pile up.
    r = gh(["repos/%s/pulls/%s/comments" % (REPO, PR), "--paginate"])
    if r.returncode == 0 and r.stdout.strip():
        try:
            for c in json.loads(r.stdout):
                if MARKER in (c.get("body") or ""):
                    gh(["-X", "DELETE", "repos/%s/pulls/comments/%s" % (REPO, c["id"])])
        except Exception:
            pass

    def fmt_inline(f):
        return "%s\n\n**[%s · confidence: %s] %s**\n\n%s" % (
            MARKER, f.get("severity", "?"), f.get("confidence", "?"), f.get("title", ""), f.get("body", ""))

    comments = [{"path": f["path"], "line": int(f["line"]), "side": "RIGHT", "body": fmt_inline(f)} for f in inline]

    body = "%s\n\n## AI review swarm" % MARKER
    if data.get("recommendation"):
        body += "  \n**Recommendation: %s**" % data["recommendation"]
    body += "\n\n" + (data.get("summary") or "_No summary produced._")
    if overflow:
        body += "\n\n### Lower-confidence / not posted inline\n"
        for f in overflow:
            loc = " (`%s:%s`)" % (f.get("path"), f.get("line")) if f.get("path") else ""
            b = (f.get("body") or "").replace("\n", " ")
            body += "\n- **[%s · %s]** %s%s — %s" % (
                f.get("severity", "?"), f.get("confidence", "?"), f.get("title", ""), loc, b)

    payload = {"commit_id": HEAD, "event": "COMMENT", "body": body, "comments": comments}
    r = gh(["repos/%s/pulls/%s/reviews" % (REPO, PR), "--input", "-"], stdin=json.dumps(payload))
    if r.returncode == 0:
        print("Posted review with %d inline comment(s), %d in body." % (len(comments), len(overflow)))
        return 0

    # Fallback: inline payload rejected (e.g. a line slipped the diff filter) -> body only.
    print("Inline review rejected, retrying body-only:\n" + r.stderr[-800:], file=sys.stderr)
    payload = {"commit_id": HEAD, "event": "COMMENT", "body": body}
    r = gh(["repos/%s/pulls/%s/reviews" % (REPO, PR), "--input", "-"], stdin=json.dumps(payload))
    if r.returncode == 0:
        print("Posted body-only review (%d findings listed)." % len(findings))
        return 0
    print("Failed to post review:\n" + r.stderr[-800:], file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
