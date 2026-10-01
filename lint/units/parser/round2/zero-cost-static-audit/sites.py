import re,sys
pat=re.compile(r'starts_for_parse_only|is_lint_parse\(\)|sidecar_mark\(\)')
for f in ['parse_prefix.rs','parse_suffix.rs','mod.rs','parse_stmt.rs','parse_fn.rs','parse_property.rs','parse_typescript.rs','parse_jsx.rs','parse_skip_typescript.rs']:
    L=open('src/js_parser/parse/'+f).read().split('\n')
    # map line -> enclosing fn and whether fn is cold
    fn=None; cold=False; pend_cold=False; info={}
    for i,l in enumerate(L):
        if re.match(r'\s*#\[cold\]',l): pend_cold=True
        m=re.match(r'\s*(pub(\(crate\))? )?(unsafe )?fn (\w+)',l)
        if m:
            fn=m.group(4); cold=pend_cold; pend_cold=False
        elif l.strip() and not l.strip().startswith('#[') and not l.strip().startswith('///'):
            pend_cold=False
        if l.startswith('#[cfg(test)]') and i>50: break
        if pat.search(l): info[i+1]=(fn,cold,l.strip())
    for ln,(fn,cold,txt) in info.items():
        print(f'{f}:{ln:<5} {"COLD " if cold else "     "}{fn:<48} {txt[:90]}')
