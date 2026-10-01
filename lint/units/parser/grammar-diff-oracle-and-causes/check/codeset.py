import re, json, sys
root = "/workspace/ref/typescript-go/internal"
gen = open(root + "/diagnostics/diagnostics_generated.go").read()
code = {}
cat = {}
text = {}
for m in re.finditer(r'^var (\w+) = &Message\{code: (\d+), category: (\w+), key: "[^"]*", text: ("(?:[^"\\]|\\.)*")', gen, re.M):
    code[m.group(1)] = int(m.group(2)); cat[m.group(1)] = m.group(3); text[m.group(1)] = json.loads(m.group(4))
def names(path):
    src = open(path).read()
    return sorted(set(re.findall(r'diagnostics\.([A-Za-z0-9_]+)', src)))
g = names(root + "/checker/grammarchecks.go")
missing = [n for n in g if n not in code]
print("names in grammarchecks.go:", len(g), "missing in generated:", missing, file=sys.stderr)
codes = sorted(set(code[n] for n in g if n in code))
print("distinct codes:", len(codes), file=sys.stderr)
json.dump({"codes": codes, "names": {n: code[n] for n in g if n in code}, "cats": {n: cat[n] for n in g if n in code}, "texts": {str(code[n]): text[n] for n in g if n in code}}, open("grammar-codes.json", "w"), indent=0)
for n in g:
    print(code.get(n), cat.get(n), n)
