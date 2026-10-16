import re, subprocess, sys
diff = subprocess.run(["git", "diff", "origin/main", "--", "src/"], capture_output=True, text=True).stdout
def is_comment(line):
    t = line.lstrip()
    return t.startswith("//") or t.startswith("/*") or t in ("*", "*/") or t.startswith("* ")
path = None; new_line = 0; cur = None; groups = []
def flush():
    global cur
    if cur and len(cur["lines"]) >= 2 and not re.search("SAFETY:", "\n".join(cur["lines"])):
        groups.append(cur)
    cur = None
for raw in diff.split("\n"):
    if raw.startswith("+++ "):
        flush(); path = raw[6:]; continue
    if raw.startswith("--- ") or raw.startswith("diff ") or raw.startswith("index "):
        flush(); continue
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
print(len(groups), "group(s) of 2+ added comment lines")
for g in groups: print(g["path"], g["start"], g["end"]); print("\n".join(g["lines"]))
print("--- all added comment lines:")
for raw in diff.split("\n"):
    if raw.startswith("+") and not raw.startswith("+++") and is_comment(raw[1:]): print(raw)
