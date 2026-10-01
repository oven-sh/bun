#!/usr/bin/env python3
# Writes main.go: getCommentPragmas, extractPragmas and their helpers, iterateCommentRanges and the shebang and
# whitespace helpers, copied verbatim from /workspace/ref/typescript-go at run time, plus a driver that applies
# the switch of processPragmasIntoFields to `name<TAB>hex` lines. Usage: python3 gen.py && GOTOOLCHAIN=local go build -o oracle . && ./oracle x.hex
ref='/workspace/ref/typescript-go/internal/'
p=open(ref+'parser/parser.go').read().split('\n')
s=open(ref+'scanner/scanner.go').read().split('\n')
u=open(ref+'stringutil/util.go').read().split('\n')
def fn(lines,name):
    i=[k for k,l in enumerate(lines) if l.startswith('func '+name+'(')][0]
    j=i
    while not lines[j].startswith('}'): j+=1
    return '\n'.join(lines[i:j+1])
out=[open('prelude.go.txt').read()]
for n in ['IsWhiteSpaceLike','IsWhiteSpaceSingleLine','IsLineBreak']: out.append(fn(u,n))
for n in ['isShebangTrivia','scanShebangTrivia','iterateCommentRanges']: out.append(fn(s,n))
for n in ['getCommentPragmas','extractPragmas','match','skipBlanks','skipNonBlanks','skipTo','lineEndPos','extractName','extractQuotedString']: out.append(fn(p,n))
src='\n\n'.join(out)
src=src.replace('ast.','').replace('core.','').replace('stringutil.','')
src=src.replace('scanner.GetLeadingCommentRanges(f, sourceText, 0)','iterateCommentRanges(f, sourceText, 0, false)')
src=src.replace('iter.Seq[CommentRange]','func(yield func(CommentRange) bool)')
src+=open('driver.go.txt').read()
open('main.go','w').write(src)
