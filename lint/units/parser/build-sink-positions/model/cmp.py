import json, re, difflib, sys
a = json.load(open(sys.argv[1])); b = json.load(open(sys.argv[2]))
show = int(sys.argv[3]) if len(sys.argv) > 3 else 40
def norm(t):
    t = re.sub(r'-?0x[0-9a-f]+\(%rip\)', 'REL(%rip)', t)
    t = re.sub(r'# <[^>]*>', '', t)
    t = re.sub(r'<writev\+0x[0-9a-f]+>', '<DATA>', t)
    t = re.sub(r'<_?[A-Za-z_][^>]*\+0x[0-9a-f]+>\(%rip\)', '<DATA>(%rip)', t)
    return t
same = []; diff = []
for n in sorted(set(a) & set(b)):
    x, y = norm(a[n]['text']), norm(b[n]['text'])
    if x == y: same.append(n); continue
    diff.append(n)
    print('DIFF', a[n]['size'], b[n]['size'], n[:150])
    d = list(difflib.unified_diff(x.splitlines(), y.splitlines(), lineterm='', n=1))
    for l in d[:show]: print('   ', l)
print('same', len(same), 'diff', len(diff), 'only-a', len(set(a) - set(b)), 'only-b', len(set(b) - set(a)))
for n in same: print('  SAME %6d %s' % (a[n]['size'], n[:150]))
for n in sorted(set(b) - set(a)): print('  ONLYB %6d %s' % (b[n]['size'], n[:150]))
