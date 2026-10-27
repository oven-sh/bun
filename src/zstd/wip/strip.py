import re,sys
src=open(sys.argv[1]).read()
# remove comments, respecting strings
out=re.sub(r'//[^\n]*|/\*.*?\*/|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'', lambda m: m.group(0) if m.group(0)[0] in '"\'' else ' ', src, flags=re.S)
lines=[l.rstrip() for l in out.split('\n')]
lines=[l for l in lines if l.strip() and not re.match(r'\s*(DEBUGLOG|RAWLOG)\(.*\);\s*$', l)]
open(sys.argv[2],'w').write('\n'.join(lines)+'\n')
