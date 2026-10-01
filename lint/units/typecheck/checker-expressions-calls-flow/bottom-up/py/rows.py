# PORT_STATUS rows for the twelve layers: one row per run of functions of one layer inside one Rust module, in upstream order.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import layers as L
print('upstream path\tlines\tgroup\tRust module\tstate\tcommit')
allf = sorted([f for f in L.fns if f['pkg'] == 'checker' and f['file'] in (L.C, L.F)], key=lambda f: (f['file'], f['decl']))
run = []
def flush():
    if not run: return
    f0, f1 = run[0], run[-1]
    names = L.short(f0) if len(run) == 1 else '%s .. %s' % (L.short(f0), L.short(f1))
    print('internal/%s\t%d-%d\t%s: %s (%d)\t%s\tnot started\t89d5d5b' % (f0['file'], f0['decl'], f1['end'], f0['layer'], names, len(run), f0['module']))
for f in allf:
    if not f['mine']:
        flush(); run = []; continue
    if run and (run[-1]['layer'] != f['layer'] or run[-1]['module'] != f['module'] or run[-1]['file'] != f['file']):
        flush(); run = []
    run.append(f)
flush()
