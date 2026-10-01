import re, json, sys, glob, os
root = "/workspace/ref/typescript-go/internal"
gen = open(root + "/diagnostics/diagnostics_generated.go").read()
code = {}
for m in re.finditer(r'^var (\w+) = &Message\{code: (\d+), category: (\w+)', gen, re.M):
    code[m.group(1)] = int(m.group(2))
D1 = set(json.load(open("grammar-codes.json"))["codes"])
E = {}
for path in sorted(glob.glob(root + "/checker/*.go")):
    if path.endswith("_test.go") or path.endswith("grammarchecks.go"): continue
    src = open(path).read()
    for m in re.finditer(r'\b(?:grammarError\w*|checkGrammar\w+)\(', src):
        # skip function definitions
        if src[max(0, m.start()-40):m.start()].rstrip().endswith(")") and "func (c *Checker)" in src[max(0, m.start()-40):m.start()]:
            continue
        i = m.end(); depth = 1
        while depth and i < len(src) and i - m.end() < 3000:
            ch = src[i]
            if ch == '(': depth += 1
            elif ch == ')': depth -= 1
            i += 1
        call = src[m.start():i]
        line = src.count("\n", 0, m.start()) + 1
        for n in re.findall(r'diagnostics\.(\w+)', call):
            E.setdefault(n, []).append(f"{os.path.basename(path)}:{line}")
# the message that a call passes as a variable: checker.go:2604 (17019 / 17020)
E.setdefault("X_0_at_the_end_of_a_type_is_not_valid_TypeScript_syntax_Did_you_mean_to_write_1", []).append("checker.go:2604")
E.setdefault("X_0_at_the_start_of_a_type_is_not_valid_TypeScript_syntax_Did_you_mean_to_write_1", []).append("checker.go:2604")
rows = sorted(((code[n], n, l) for n, l in E.items() if n in code))
new = sorted(set(c for c, n, l in rows if c not in D1))
print("E (other files of internal/checker):", len(rows), "names,", len(new), "codes not in D1")
for c, n, l in rows:
    if c not in D1: print("  ", c, n[:95], l[:3])
json.dump({"new": new}, open("checker-grammar-codes.json", "w"))
print(new)
