# Joins the hand-written parts (doc/head.txt, driver.txt, notes.txt, tail.txt) with data/fn-tables.txt into data/work-tables.txt.
import collections, sys
W = sys.argv[1] if len(sys.argv) > 1 else '/tmp/cdg'
notes = collections.OrderedDict(); cur = None
for ln in open(W + '/doc/notes.txt').read().split('\n'):
    if ln.startswith('@'): cur = ln[1:].strip(); notes[cur] = []
    elif ln.strip() and cur: notes[cur].append(ln)
blocks = open(W + '/data/fn-tables.txt').read().strip().split('\n\n')
sec = ["", "== 4. WORK TABLES (one per layer, landing names as in section 1) ==",
"Keys: FN functions in upstream order by range; `*` a caller in another section or in an earlier layer of this table exists (its stand-in is entered before this layer lands), `+` entered by the K4 run, `!` contains an upstream panic or assert. NOTE what a mechanical port has to know beyond the text of the function. OUT callees in later layers of this table (the stand-ins still reachable when this layer lands). CODES diagnostics referenced in the layer. PANIC and ASSERT upstream lines. PROGRAM methods of the Program interface. MAPRANGE Go map or set iteration (function@line).", ""]
for b in blocks:
    lines = b.split('\n'); name = lines[0].split()[1]
    fn = [l for l in lines[1:] if l.startswith('FN ')]; rest = [l for l in lines[1:] if not l.startswith('FN ')]
    sec += [lines[0]] + fn + notes.get(name, []) + rest + ['']
body = open(W + '/doc/head.txt').read().rstrip('\n') + '\n' + open(W + '/doc/driver.txt').read().rstrip('\n') + '\n' + '\n'.join(sec).rstrip('\n') + '\n\n' + open(W + '/doc/tail.txt').read()
open(W + '/data/work-tables.txt', 'w').write(body); print(len(body))
