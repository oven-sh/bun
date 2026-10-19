import re, sys, difflib
txt=open('/tmp/h/tokmerge-report2.txt').read()
hunks=[h for h in re.split(r'(?m)^(?==== HUNK )', txt) if h.strip()]
lo=int(sys.argv[1]); hi=int(sys.argv[2]); maxl=int(sys.argv[3]) if len(sys.argv)>3 else 45
for h in hunks:
    head=h.split('\n')[0]
    num=int(head.split()[2])
    if not (lo<=num<=hi): continue
    m=re.search(r'(?s)\n--- base\n(.*?)\n--- ours\n(.*?)\n--- theirs\n(.*?)\n--- conflict 0', h)
    base, ours, theirs = m.groups()
    print(head)
    print('  [ours vs base]')
    for l in difflib.unified_diff(base.split('\n'), ours.split('\n'), lineterm='', n=0):
        if l.startswith('---') or l.startswith('+++') or l.startswith('@@'): continue
        print('    '+l[:190])
    print('  [theirs vs base]')
    d=[l for l in difflib.unified_diff(base.split('\n'), theirs.split('\n'), lineterm='', n=0) if not (l.startswith('---') or l.startswith('+++'))]
    for l in d[:maxl]:
        print('    '+l[:190])
    if len(d)>maxl: print(f'    ... ({len(d)-maxl} more diff lines)')
    print()
