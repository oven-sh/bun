#!/usr/bin/env python3
# Writes main.go: processCommentDirective, char, charAt, charAndSize, scanASCIIWhile and the comment arms of Scan,
# copied verbatim from /workspace/ref/typescript-go at run time, plus a driver that finds comments by a plain search for // and /*.
# Usage: python3 gen.py && go run . ../inputs.json   (inputs whose only slashes are comments)
import os
here=os.path.dirname(os.path.abspath(__file__))
ref='/workspace/ref/typescript-go/internal/'
s=open(ref+'scanner/scanner.go').read().split('\n')
u=open(ref+'stringutil/util.go').read().split('\n')
def fn(lines,name,method=False):
    pre='func (s *Scanner) '+name+'(' if method else 'func '+name+'('
    i=[k for k,l in enumerate(lines) if l.startswith(pre)][0]
    j=i
    while not lines[j].startswith('}'): j+=1
    return '\n'.join(lines[i:j+1])
# the arm of Scan for '/': from the line after "case '/':" to the line before "if s.charAt(1) == '=' {"
scan=[k for k,l in enumerate(s) if l.startswith('func (s *Scanner) Scan() ast.Kind {')][0]
a=[k for k in range(scan,len(s)) if s[k].strip()=="case '/':"][0]
b=[k for k in range(a,len(s)) if s[k].strip()=="if s.charAt(1) == '=' {"][0]
arm=s[a+1:b]
arm=[l.replace('continue','return true').replace('return s.token','return true') for l in arm]
out=[open(os.path.join(here,'prelude.go.txt')).read()]
out.append(fn(u,'IsLineBreak'))
for n in ['char','charAt','charAndSize','scanASCIIWhile','processCommentDirective']: out.append(fn(s,n,True))
out.append('func (s *Scanner) scanCommentArm() bool {\n'+'\n'.join(arm)+'\n\treturn false\n}')
src='\n\n'.join(out)
src=src.replace('ast.','').replace('core.','').replace('stringutil.','').replace('diagnostics.','')
src+=open(os.path.join(here,'driver.go.txt')).read()
open(os.path.join(here,'main.go'),'w').write(src)
import sys; print('arm lines', a+2, 'to', b, '=', len(arm), file=sys.stderr)
