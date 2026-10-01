import re,sys,os
root='src/js_parser'
files=[]
for d,_,fs in os.walk(root):
    for f in fs:
        if f.endswith('.rs'): files.append(os.path.join(d,f))
files.sort()
callre=re.compile(r'\b(add_error|add_error_fmt|add_error_fmt_opts|add_range_error|add_range_error_fmt|add_range_error_fmt_with_note|add_range_error_fmt_with_notes|add_range_error_with_notes|add_syntax_error|add_default_error|add_unsupported_syntax_error|add_range_error_with_note|expected_string|expect_contextual_keyword)\s*\(')
for f in files:
    if '/visit' in f or '/scan/' in f: continue
    src=open(f).read()
    for m in callre.finditer(src):
        line=src.count('\n',0,m.start())+1
        seg=src[m.start():m.start()+600]
        # find first string literal
        s=re.search(r'b?"((?:[^"\\]|\\.)*)"',seg)
        txt=s.group(1) if s else '?'
        # stop if the literal is too far (different statement)
        print('%s:%d\t%s\t%s'%(f[len(root)+1:],line,m.group(1),txt))
