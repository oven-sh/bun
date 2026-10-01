import re, sys
root = '/workspace/ref/typescript-go/internal'
diag = {}
for line in open(root + '/diagnostics/diagnostics_generated.go', encoding='utf-8'):
    m = re.match(r'var (\w+) = &Message\{code: (\d+), category: Category(\w+), key: "([^"]*)", text: "((?:[^"\\]|\\.)*)"\}', line)
    if m:
        diag[m.group(1)] = (int(m.group(2)), m.group(3), m.group(5))
src = open(root + '/parser/parser.go', encoding='utf-8').read().split('\n')
# function spans
func_at = {}
cur = None
for i, l in enumerate(src, 1):
    m = re.match(r'func (?:\(p \*Parser\) )?(\w+)\(', l)
    if m:
        cur = m.group(1)
    func_at[i] = cur
n = 0
for i, l in enumerate(src, 1):
    if 'parseErrorAt' in l:
        if re.match(r'func ', l):
            print(f"{i}\tDEF\t{l.strip()[:80]}")
            continue
        ids = re.findall(r'diagnostics\.(\w+)', l)
        kind = re.search(r'parseErrorAt(CurrentToken|Range)?', l).group(0)
        if ids:
            for d in ids:
                c = diag.get(d)
                print(f"{i}\t{func_at[i]}\t{kind}\tTS{c[0]}\t{c[2]}")
        else:
            print(f"{i}\t{func_at[i]}\t{kind}\t(variable)\t{l.strip()[:110]}")
        n += 1
print("call lines:", n, file=sys.stderr)
