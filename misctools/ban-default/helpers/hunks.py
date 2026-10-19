import sys, re
# prints conflict hunks of the files given, diff3 style
files = [l.strip() for l in open('/tmp/h/conflicted.txt') if l.strip()]
only = sys.argv[1:] 
hn=0
for f in files:
    if only and not any(o in f for o in only): continue
    lines = open(f, encoding='utf8').read().split('\n')
    i=0
    while i < len(lines):
        if lines[i].startswith('<<<<<<< '):
            hn+=1
            j=i
            while not lines[j].startswith('>>>>>>> '): j+=1
            print(f'=== HUNK {hn} {f}:{i+1}-{j+1} ===')
            for k in range(max(0,i-3), i): print('   ' + lines[k])
            for k in range(i, j+1): print(lines[k])
            for k in range(j+1, min(len(lines), j+4)): print('   ' + lines[k])
            i=j+1
        else:
            i+=1
