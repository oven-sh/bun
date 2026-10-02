import re, sys, glob
names = ["error","add_diagnostic","add_suggestion_diagnostic","error_or_suggestion","error_and_maybe_suggest_await","error_skipped_on_no_emit","add_error_or_suggestion","is_deprecated_symbol","add_deprecated_suggestion","add_deprecated_suggestion_worker","add_deferred_diagnostic","produce_deferred_diagnostics","has_parse_diagnostics","is_deprecated_declaration","get_diagnostics","get_diagnostics_exported","get_suggestion_diagnostics","get_global_diagnostics","new_diagnostic_for_node","check_not_canceled","create_diagnostic_for_node"]
def split_args(s):
    args=[];depth=0;cur="";i=0;instr=False
    while i < len(s):
        ch=s[i]
        if instr:
            cur+=ch
            if ch=="\\": cur+=s[i+1]; i+=1
            elif ch=='"': instr=False
        elif ch=='"': instr=True; cur+=ch
        elif ch in "([{": depth+=1; cur+=ch
        elif ch in ")]}": depth-=1; cur+=ch
        elif ch=="," and depth==0: args.append(cur.strip()); cur=""
        else: cur+=ch
        i+=1
    if cur.strip(): args.append(cur.strip())
    return args
from collections import Counter
shapes={n:Counter() for n in names}
examples={n:{} for n in names}
for path in sorted(glob.glob("checker/*.rs")+glob.glob("evaluator/*.rs")+glob.glob("modulespecifiers/*.rs")):
    src=open(path,encoding="utf8",errors="replace").read()
    for n in names:
        for m in re.finditer(r"(?:self|c|self\.c|checker|self\.checker)\s*\.\s*"+n+r"\(", src):
            i=m.end(); depth=1; j=i; instr=False
            while j < len(src) and depth>0:
                ch=src[j]
                if instr:
                    if ch=="\\": j+=1
                    elif ch=='"': instr=False
                elif ch=='"': instr=True
                elif ch in "([{": depth+=1
                elif ch in ")]}": depth-=1
                j+=1
            args=split_args(src[i:j-1])
            key=len(args)
            shapes[n][key]+=1
            line=src.count("\n",0,m.start())+1
            examples[n].setdefault(key,[]).append(f"{path}:{line}")
for n in names:
    print(n, dict(shapes[n]), {k:v[:3] for k,v in examples[n].items()})
