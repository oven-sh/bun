#!/usr/bin/env python3
# usage: from-release-raw.py <raw-release.jsonl> <work directory> [report of a sweep over the same instances, for the codes of the oracles]
# Makes, of the raw runs of a release build (round2/default-check-classification/*/probes/raw.ts: every run instance
# through `<binary> --lint <operands>` as the default check starts it), the files that finish.sh reads:
#   <work>/reports/release.json   what sweep.ts of 3110ce85cf reports for each instance, by the rules of its default check
#                                 (check_bun_lint.ts readRun and toCheckResult, run.ts compare), applied to what came back
#   <work>/raw.jsonl              the runs that wrote to stderr or did not end by themselves, in the shape of raw.ts
#   <work>/driver.log             two lines that say where the runs are from
# No process is started. The outcome of an instance is a function of exit code, signal, stdout and stderr alone, so
# the table is the one that a sweep of that binary gives, as long as the binary prints the same again.
import json
import os
import re
import sys

raw_path, work = sys.argv[1:3]
codes_from = sys.argv[3] if len(sys.argv) > 3 else None
os.makedirs(os.path.join(work, "reports"), exist_ok=True)

GLOBAL = re.compile(r"^(error|warning|suggestion|message) (?:TS(-?\d+)|([A-Za-z@][A-Za-z0-9@/_-]*)): (.*)$", re.S)
LOCATED = re.compile(r"^(\S.*?)\((\d+),(\d+)\): (error|warning|suggestion|message) (?:TS(-?\d+)|([A-Za-z@][A-Za-z0-9@/_-]*)): (.*)$", re.S)


def head(text):
    for line in re.split(r"\r?\n", text):
        if line.strip():
            return line[:200] + "..." if len(line) > 200 else line
    return ""


def parse_plain(text):
    """tsc_plain_format.ts parsePlainDiagnostics: (ok, list of (line number, category, ts code, name)) or (False, reason)."""
    out = []
    if text == "":
        return True, out
    lines = text.split("\n")
    if lines[-1] != "":
        return False, f"stderr line {len(lines)} is the last line has no line break: {head(lines[-1])}"
    lines.pop()
    open_chain = 0
    for i, line in enumerate(lines):
        if line.endswith("\r"):
            line = line[:-1]
        m = GLOBAL.match(line)
        if m:
            out.append((i + 1, m.group(1), m.group(2), m.group(3)))
            open_chain = 1
            continue
        m = LOCATED.match(line)
        if m:
            if int(m.group(2)) == 0 or int(m.group(3)) == 0:
                return False, f"stderr line {i + 1} is line and column are 1-based: {head(line)}"
            out.append((i + 1, m.group(4), m.group(5), m.group(6)))
            open_chain = 1
            continue
        spaces = len(line) - len(line.lstrip(" "))
        if spaces < 2 or spaces == len(line):
            return False, f"stderr line {i + 1} is neither a diagnostic nor a line of a message chain: {head(line)}"
        if open_chain == 0:
            return False, f"stderr line {i + 1} is a line of a message chain before any diagnostic: {head(line)}"
    return True, out


def outcome_of(r):
    if "notLaid" in r:
        return "unsupported", r["notLaid"]
    if r.get("timedOut"):
        return "timeout", "the check did not end within the limit"
    threw = lambda reason: ("crash", f"the check threw: Error: {reason}")
    if r.get("signal") is not None:
        return threw(f"the command ended by the signal {r['signal']}")
    if r.get("exitCode") == 1:
        return threw(f"the command refused: {head(r.get('stderr', ''))}")
    if r.get("exitCode") not in (0, 2):
        return threw(f"the command ended with the exit code {r.get('exitCode')}")
    if r.get("stdout"):
        return threw(f"the command wrote to stdout: {head(r['stdout'])}")
    ok, parsed = parse_plain(r.get("stderr", ""))
    if not ok:
        return threw(parsed)
    errors = sum(1 for d in parsed if d[1] == "error")
    if r["exitCode"] == 0 and errors > 0:
        return threw(f"the exit code is 0 and stderr has {errors} errors")
    if r["exitCode"] == 2 and errors == 0:
        return threw("the exit code is 2 and stderr has no error")
    stand_ins = 0
    coded = 0
    for at, _category, ts, name in parsed:
        if ts is not None:
            coded += 1
        elif name == "internal-stand-in":
            stand_ins += 1
        elif name == "internal-error":
            return threw("the command reports an error of its own")
        else:
            return threw(f"stderr line {at} has the code {name}, which is no code of TypeScript")
    if stand_ins > 0:
        return "provisional", f"the check reached {stand_ins} stand-ins"
    if r["kind"] == "C":
        return ("pass", "") if coded == 0 else ("fail", f"{coded} diagnostics where the oracle has none")
    if coded == 0:
        return "fail", "no diagnostic where the oracle has a baseline"
    return "fail", "diagnostics with codes of TypeScript: not compared here"


records = [json.loads(line) for line in open(raw_path, encoding="utf8") if line.strip()]
instances = {}
raw_out = []
ms = 0
for r in records:
    outcome, reason = outcome_of(r)
    instances[r["name"]] = {"kind": r["kind"], "casePath": r["casePath"], "outcome": outcome, "reason": reason}
    ms += r.get("ms", 0)
    if outcome in ("crash", "timeout"):
        died = ""
        if r.get("timedOut"):
            died = "the time limit"
        elif r.get("signal") is not None:
            died = f"signal {r['signal']}"
        elif r.get("exitCode") not in (0, 2):
            died = f"exit code {r.get('exitCode')}"
        elif r.get("stdout"):
            died = "stdout"
        elif not parse_plain(r.get("stderr", ""))[0]:
            died = "stderr is no list of diagnostics"
        raw_out.append({**r, "was": "", "died": died})
codes = {}
unread = []
if codes_from is not None:
    report = json.load(open(codes_from, encoding="utf8"))
    codes = report.get("codes", {})
    unread = report.get("codesUnread", [])
report = {
    "version": 1,
    "check": f"the raw runs of {raw_path}",
    "selectors": [],
    "seconds": round(ms / 1000),
    "totals": {"selected": len(records), "run": len(records), "skipped": 0, "invalid": 0},
    "codes": codes,
    "codesUnread": unread,
    "instances": instances,
}
json.dump(report, open(os.path.join(work, "reports", "release.json"), "w", encoding="utf8"))
with open(os.path.join(work, "raw.jsonl"), "w", encoding="utf8") as f:
    for r in raw_out:
        f.write(json.dumps(r) + "\n")
with open(os.path.join(work, "driver.log"), "w", encoding="utf8") as f:
    f.write(f"### lock acquired (no sweep: the raw runs of {raw_path}, {len(records)} records) bin {os.environ.get('RELEASE_REVISION', 'a release build')}\n")
    f.write(f"### finished (the outcomes are the rules of the default check of 3110ce85cf over these runs)\n")
print(f"{len(records)} records; {len(raw_out)} with the outcome crash or timeout; reports/release.json, raw.jsonl and driver.log in {work}")
