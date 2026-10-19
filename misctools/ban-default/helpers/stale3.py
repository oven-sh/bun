import re, subprocess, collections
# 1. comments near code where this branch turned take into replace and that still say "take"
diff = subprocess.run(['git','diff','-U0','origin/main','--','src'],capture_output=True,text=True).stdout
cur=None; newline=0
sites=collections.defaultdict(set)
removed_take=False
for l in diff.split('\n'):
    if l.startswith('+++ b/'):
        cur=l[6:]; continue
    m=re.match(r'@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@', l)
    if m:
        newline=int(m.group(1)); removed_take=False; continue
    if l.startswith('-') and not l.startswith('---'):
        if re.search(r'\btake\s*\(|\.take\(\)|unwrap_or_default|or_default\(\)', l): removed_take=True
    elif l.startswith('+') and not l.startswith('+++'):
        if removed_take and re.search(r'replace\s*\(|unwrap_or|or_insert', l) and cur and cur.endswith('.rs'):
            sites[cur].add(newline)
        newline+=1
out=[]
for f, lines in sites.items():
    try: txt=open(f,encoding='utf8',errors='replace').read().split('\n')
    except Exception: continue
    seen=set()
    for ln in sorted(lines):
        for k in range(max(0,ln-9), min(len(txt), ln+3)):
            l=txt[k]; c=l.find('//')
            if c<0 or k in seen: continue
            com=l[c:]
            if re.search(r'\btake\b|take\(\)|mem::take|unwrap_or_default|or_default', com):
                seen.add(k); out.append(f'{f}:{k+1}: {l.strip()[:220]}')
# 2. the hand-picked lines that mention Default without backticks
picked = """src/ast/nodes.rs:1123
src/bun_alloc/ast_alloc.rs:500
src/bundler/linker_context/doStep5.rs:494
src/collections/vec_ext.rs:592
src/install/npm.rs:3013
src/install/npm.rs:3511
src/install/padding_checker.rs:26
src/install/repository.rs:13
src/install_types/resolver_hooks.rs:49
src/js_parser/p.rs:7484
src/js_parser/p.rs:9186
src/js_printer/lib.rs:7664
src/jsc/VirtualMachine.rs:5681
src/runtime/api/JSTranspiler.rs:562
src/runtime/api/YAMLObject.rs:119
src/runtime/bake/dev_server/incremental_graph.rs:158
src/runtime/cli/create_command.rs:1110
src/runtime/cli/mod.rs:303
src/runtime/cli/test/parallel/Channel.rs:58
src/runtime/timer/mod.rs:85
src/shell_parser/parse.rs:581
src/sema/local.rs:205""".split('\n')
have=set(o.split(': ')[0] for o in out)
for p in picked:
    f,ln=p.rsplit(':',1)
    txt=open(f,encoding='utf8',errors='replace').read().split('\n')
    key=f'{f}:{ln}'
    if key not in have:
        out.append(f'{key}: {txt[int(ln)-1].strip()[:220]}')
out=sorted(set(out), key=lambda s:(s.split(':')[0], int(s.split(':')[1])))
open('/tmp/h/stale3.txt','w').write('\n'.join(out)+'\n')
print(len(out))
