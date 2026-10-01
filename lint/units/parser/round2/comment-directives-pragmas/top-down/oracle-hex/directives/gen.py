#!/usr/bin/env python3
# Writes main.go: processCommentDirective, char, charAt, charAndSize, scanASCIIWhile and IsLineBreak copied verbatim
# from /workspace/ref/typescript-go at run time, and the two comment arms of Scan copied by their anchors into a
# driver that steps over every other rune and reads `name<TAB>hex` lines. Usage: python3 gen.py && GOTOOLCHAIN=local go build -o oracle . && ./oracle x.hex
ref='/workspace/ref/typescript-go/internal/'
s=open(ref+'scanner/scanner.go').read().split('\n')
u=open(ref+'stringutil/util.go').read().split('\n')
def fn(lines,name,method=True):
    pre='func (s *Scanner) '+name+'(' if method else 'func '+name+'('
    i=[k for k,l in enumerate(lines) if l.startswith(pre)][0]
    j=i
    while not lines[j].startswith('}'): j+=1
    return '\n'.join(lines[i:j+1])
def block(lines,first,last_contains):
    i=[k for k,l in enumerate(lines) if l.strip()==first][0]
    j=i
    while last_contains not in lines[j]: j+=1
    return lines[i:j+1]
single=block(s,'// Single-line comment','s.processCommentDirective(s.tokenStart, s.pos, false)')
multi=block(s,'// Multi-line comment','s.processCommentDirective(lastLineStart, s.pos, true)')
single=single+['\t\t\t\ts.comments = append(s.comments, fmt.Sprintf("Line %d..%d", s.tokenStart, s.pos))','\t\t\t\tcontinue','\t\t\t}']
multi=multi+['\t\t\t\t_ = commentClosed','\t\t\t\ts.comments = append(s.comments, fmt.Sprintf("Block %d..%d jsdoc=%v lastLineStart=%d", s.tokenStart, s.pos, isJSDoc, lastLineStart))','\t\t\t\tcontinue','\t\t\t}']
out=[open('prelude.go.txt').read()]
out.append(fn(u,'IsLineBreak',False))
for n in ['char','charAt','charAndSize','scanASCIIWhile','processCommentDirective']: out.append(fn(s,n))
src='\n\n'.join(out)
drv=open('driver.go.txt').read().replace('\t\t\t//SINGLE//','\n'.join(single)).replace('\t\t\t//MULTI//','\n'.join(multi))
src=(src+drv).replace('ast.','').replace('core.','').replace('stringutil.','')
open('main.go','w').write(src)
