import sys
def is_comment(line):
    t = line.lstrip()
    return t.startswith('//') or t.startswith('/*') or t == '*' or t == '*/' or t.startswith('* ')
bad = 0
for p in sys.argv[1:]:
    run = []
    for i, line in enumerate(open(p).read().split('\n'), 1):
        if is_comment(line):
            run.append(i)
        else:
            if len(run) >= 2:
                print('%s:%d-%d: run of %d comment lines' % (p, run[0], run[-1], len(run)))
                bad += 1
            run = []
    if len(run) >= 2:
        print('%s:%d-%d: run of %d comment lines' % (p, run[0], run[-1], len(run))); bad += 1
    for i, line in enumerate(open(p).read().split('\n'), 1):
        for w in ('TODO', 'FIXME', 'XXX', 'HACK'):
            if w in line:
                print('%s:%d: %s' % (p, i, w)); bad += 1
        if len(line) > 100 and not line.lstrip().startswith('//'):
            print('%s:%d: code line of %d columns' % (p, i, len(line)))
print('comment groups/markers found:', bad)
