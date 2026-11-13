import subprocess, re, sys
base = sys.argv[1] if len(sys.argv) > 1 else "pr-48488"
diff = subprocess.run(["git", "diff", base, "--", "src/"], capture_output=True, text=True).stdout
path = None; new_line = 0; cur = None; out = []
def is_comment(line):
    t = line.lstrip()
    return t.startswith("//") or t.startswith("/*") or t in ("*", "*/") or t.startswith("* ")
def flush():
    global cur
    if cur and len(cur["lines"]) >= 2 and "SAFETY:" not in "\n".join(cur["lines"]):
        out.append(cur)
    cur = None
for raw in diff.split("\n"):
    if raw.startswith("+++ b/"):
        flush(); path = raw[6:]; continue
    if raw.startswith("--- ") or raw.startswith("diff ") or raw.startswith("index "):
        continue
    if raw.startswith("@@"):
        flush(); m = re.search(r"\+(\d+)", raw); new_line = int(m.group(1)) if m else 1
    elif raw.startswith("+"):
        content = raw[1:]
        if is_comment(content):
            if cur: cur["end"] = new_line; cur["lines"].append(content)
            else: cur = {"path": path, "start": new_line, "end": new_line, "lines": [content]}
        else: flush()
        new_line += 1
    elif raw.startswith("-"): flush()
    elif raw.startswith("\\"): pass
    else: flush(); new_line += 1
flush()
for g in out:
    print(f"{g['path']}:{g['start']}-{g['end']}")
    for line in g["lines"]: print("   ", line.strip())
print(len(out), "groups")
