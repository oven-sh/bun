import os, re, sys
root = sys.argv[1]
head = re.compile(rb'^(.*?)\((\d+),(\d+)\): (error|warning|suggestion|message) TS(-?\d+): (.*)$')
ghead = re.compile(rb'^(error|warning|suggestion|message) TS(-?\d+): (.*)$')
files = 0
pairs_same_pos_code = 0
text_disagree = []
chain_only = 0
same_all = 0
pairs_same_pos = 0
code_disagree_same_pos = 0
for d, _, names in os.walk(root):
    for n in names:
        if not n.endswith('.errors.txt'): continue
        p = os.path.join(d, n)
        data = open(p, 'rb').read()
        top = data.split(b'\r\n\r\n\r\n', 1)[0] if b'\r\n\r\n\r\n' in data else data.split(b'\n\n\n',1)[0]
        lines = top.replace(b'\r\n', b'\n').split(b'\n')
        diags = []
        for ln in lines:
            m = head.match(ln)
            if m:
                diags.append([m.group(1), int(m.group(2)), int(m.group(3)), int(m.group(5)), m.group(6), [], m.group(4)])
                continue
            g = ghead.match(ln)
            if g:
                diags.append([b'', 0, 0, int(g.group(2)), g.group(3), [], g.group(1)])
                continue
            if ln.startswith(b'  ') and diags:
                diags[-1][5].append(ln)
        files += 1
        for a, b in zip(diags, diags[1:]):
            if a[0] == b[0] and a[1] == b[1] and a[2] == b[2]:
                pairs_same_pos += 1
                if a[3] > b[3]: code_disagree_same_pos += 1
                if a[3] == b[3]:
                    pairs_same_pos_code += 1
                    if a[4] == b[4]:
                        if a[5] == b[5]: same_all += 1
                        else: chain_only += 1
                    elif a[4] > b[4]:
                        text_disagree.append((p, a, b))
print('files', files)
print('adjacent pairs same file,line,col', pairs_same_pos, 'of which code order reversed', code_disagree_same_pos)
print('adjacent pairs same file,line,col,code', pairs_same_pos_code)
print('  identical head text, identical chain', same_all)
print('  identical head text, chain differs', chain_only)
print('  head text in DEscending byte order (text compare would flip)', len(text_disagree))
for p, a, b in text_disagree[:40]:
    print('   ', os.path.relpath(p, root)); print('      ', a[0], a[1], a[2], a[3], a[4][:150]); print('      ', b[0], b[1], b[2], b[3], b[4][:150])
