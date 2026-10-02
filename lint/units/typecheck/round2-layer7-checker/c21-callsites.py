# The calls of the 18 functions of checker.go 14052-14168 (and of the three that they call) in checker/, evaluator/ and modulespecifiers/.
# For each name: how many calls have how many arguments, and the calls whose message arguments are not written `&[...]`.
# Run in src/typecheck: python3 /workspace/notes/lint/units/typecheck/round2-layer7-checker/c21-callsites.py
import glob
import re
from collections import Counter

NAMES = [
    "get_diagnostics_exported", "get_suggestion_diagnostics", "get_diagnostics", "get_global_diagnostics",
    "add_deferred_diagnostic", "produce_deferred_diagnostics", "add_diagnostic", "add_suggestion_diagnostic",
    "error", "error_skipped_on_no_emit", "error_or_suggestion", "error_and_maybe_suggest_await",
    "add_error_or_suggestion", "is_deprecated_declaration", "add_deprecated_suggestion",
    "add_deprecated_suggestion_worker", "is_deprecated_symbol", "has_parse_diagnostics",
    "new_diagnostic_for_node", "create_diagnostic_for_node", "check_not_canceled",
]
# The position of `args ...any` among the arguments.
ARGS_AT = {
    "error": 2, "error_skipped_on_no_emit": 2, "error_or_suggestion": 3, "error_and_maybe_suggest_await": 3,
    "new_diagnostic_for_node": 2, "create_diagnostic_for_node": 2,
}
RECEIVER = r"(?:self|c|self\.c|checker|self\.checker)\s*\.\s*"


def call_end(src, start):
    depth, at, in_string = 1, start, False
    while at < len(src) and depth > 0:
        ch = src[at]
        if in_string:
            if ch == "\\":
                at += 1
            elif ch == '"':
                in_string = False
        elif ch == '"':
            in_string = True
        elif ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        at += 1
    return at - 1


def split_args(text):
    args, depth, current, at, in_string = [], 0, "", 0, False
    while at < len(text):
        ch = text[at]
        if in_string:
            current += ch
            if ch == "\\" and at + 1 < len(text):
                current += text[at + 1]
                at += 1
            elif ch == '"':
                in_string = False
        elif ch == '"':
            in_string = True
            current += ch
        elif ch in "([{":
            depth += 1
            current += ch
        elif ch in ")]}":
            depth -= 1
            current += ch
        elif ch == "," and depth == 0:
            args.append(current.strip())
            current = ""
        else:
            current += ch
        at += 1
    if current.strip():
        args.append(current.strip())
    return args


counts = {name: Counter() for name in NAMES}
not_literal = []
files = sorted(glob.glob("checker/*.rs") + glob.glob("evaluator/*.rs") + glob.glob("modulespecifiers/*.rs"))
for path in files:
    src = open(path, encoding="utf8", errors="replace").read()
    for name in NAMES:
        for match in re.finditer(RECEIVER + name + r"\(", src):
            args = split_args(src[match.end():call_end(src, match.end())])
            counts[name][len(args)] += 1
            at = ARGS_AT.get(name)
            if at is not None and (len(args) <= at or not args[at].startswith("&[")):
                line = src.count("\n", 0, match.start()) + 1
                written = args[at] if len(args) > at else "(missing)"
                not_literal.append(f"{path}:{line}: {name}(..., {written[:60]})")

for name in NAMES:
    by_count = ", ".join(f"{n} with {k} arguments" for k, n in sorted(counts[name].items()))
    print(f"{name}: {by_count or 'no call'}")
print("message arguments that are not written `&[...]`:")
for line in not_literal:
    print("  " + line)
