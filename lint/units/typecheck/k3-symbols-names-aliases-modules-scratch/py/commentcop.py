import sys
def is_comment(line):
    t = line.lstrip()
    return t.startswith('//') or t.startswith('/*') or t == '*' or t == '*/' or t.startswith('* ')
bad = 0
for f in sys.argv[1:]:
    lines = open(f).read().split('\n')
    run = 0
    for i, l in enumerate(lines):
        if is_comment(l):
            run += 1
            if run == 2:
                print(f"{f}:{i}: consecutive comment lines"); bad += 1
        else:
            run = 0
print("bad", bad)
