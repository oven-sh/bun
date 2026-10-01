# Runs of two or more comment lines and the markers that the rules forbid; arguments: source files.
import sys


def is_comment(line):
    t = line.lstrip()
    return t.startswith('//') or t.startswith('/*') or t == '*' or t == '*/' or t.startswith('* ')


bad = 0
for p in sys.argv[1:]:
    run = []
    for i, line in enumerate(open(p).read().split('\n') + [''], 1):
        if is_comment(line):
            run.append(i)
            continue
        if len(run) >= 2:
            print('%s:%d-%d: run of %d comment lines' % (p, run[0], run[-1], len(run)))
            bad += 1
        run = []
        for w in ('TODO', 'FIXME', 'XXX', 'HACK'):
            if w in line:
                print('%s:%d: %s' % (p, i, w))
                bad += 1
print('comment runs and markers found:', bad)
sys.exit(1 if bad else 0)
