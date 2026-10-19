import re, sys, difflib
txt=open('/tmp/h/tokmerge-report.txt').read()
hunks=[h for h in re.split(r'(?m)^(?==== HUNK )', txt) if h.strip()]
lo=int(sys.argv[1]); hi=int(sys.argv[2])
n=0
for h in hunks:
    head=h.split('\n')[0]
    num=int(head.split()[2])
    if 'CLEAN' not in head or not (lo<=num<=hi): continue
    m=re.search(r'(?s)\n--- base\n(.*?)\n--- ours\n(.*?)\n--- theirs\n(.*?)\n--- merged\n(.*)\n\n$', h+'\n')
    if not m:
        print(head, 'PARSE FAIL'); continue
    base, ours, theirs, merged = m.groups()
    print(head)
    for l in difflib.unified_diff(theirs.split('\n'), merged.split('\n'), 'theirs', 'merged', lineterm='', n=1):
        if l.startswith('---') or l.startswith('+++'): continue
        print('  '+l[:200])
    print()
