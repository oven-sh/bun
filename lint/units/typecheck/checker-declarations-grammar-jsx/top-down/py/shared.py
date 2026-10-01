# Diagnostic messages that two packages of the reference both name: checker against parser, scanner and binder.
# usage: shared.py      (reads /workspace/ref/typescript-go/internal)
import re, glob, collections, os
os.chdir('/workspace/ref/typescript-go/internal')
codes = {}
for line in open('diagnostics/diagnostics_generated.go'):
    m = re.match(r'var (\w+) = &Message\{code: (\d+), category: Category(\w+),', line)
    if m: codes[m.group(1)] = (int(m.group(2)), m.group(3))
def refs(files):
    out = collections.defaultdict(list)
    for f in files:
        for i, l in enumerate(open(f), 1):
            for m in re.finditer(r'diagnostics\.([A-Za-z_0-9]+)', l):
                if m.group(1) in codes: out[m.group(1)].append(f"{f.split('/')[-1]}:{i}")
    return out
src = lambda d: [f for f in glob.glob(d + '/*.go') if not f.endswith('_test.go')]
parser, scanner, binder, chk = refs(src('parser')), refs(src('scanner')), refs(src('binder')), refs(src('checker'))
ts = open('../_submodules/TypeScript/src/compiler/parser.ts').read()
def show(name, a, b, extra=False):
    s = sorted(set(a) & set(b), key=lambda n: codes[n][0])
    print(f"== {name}: {len(s)}")
    for n in s:
        t = ''
        if extra:
            # the reference prefixes X_ to names that TypeScript starts with a lower case letter, a digit or an underscore
            cands = [n] + ([n[1:], n[2:]] if n.startswith('X_') else [])
            t = f"\tTypeScript parser.ts sites {max(len(re.findall(r'Diagnostics\.' + c + r'\b', ts)) for c in cands)}, reference parser sites {len(b[n])}"
        print(f"{codes[n][0]}\t{n}\tchecker {','.join(a[n][:6])}\tother {','.join(b[n][:6])}{t}")
show('checker and parser', chk, parser, True)
show('checker and scanner', chk, scanner)
show('checker and binder', chk, binder)
