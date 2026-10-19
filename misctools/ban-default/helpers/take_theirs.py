import sys
files = [l.strip() for l in open('/tmp/h/conflicted.txt') if l.strip()]
n=0
for f in files:
    lines = open(f, encoding='utf8').read().split('\n')
    out=[]; i=0; changed=False
    while i < len(lines):
        if lines[i].startswith('<<<<<<< '):
            while lines[i] != '=======': i += 1
            i += 1
            while not lines[i].startswith('>>>>>>> '):
                out.append(lines[i]); i += 1
            i += 1
            n += 1; changed=True
        else:
            out.append(lines[i]); i += 1
    if changed:
        open(f,'w',encoding='utf8').write('\n'.join(out))
print('resolved to theirs:', n)
