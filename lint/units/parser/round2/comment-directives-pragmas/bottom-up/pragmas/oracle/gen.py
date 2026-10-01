#!/usr/bin/env python3
# Writes main.go (output without argument values, known arguments only, one line per input): getCommentPragmas, extractPragmas and their helpers, iterateCommentRanges and the shebang and
# whitespace helpers, copied verbatim from /workspace/ref/typescript-go at run time, plus a driver that applies
# the switch of processPragmasIntoFields. Usage: python3 gen.py && go run . ../pragma-inputs.json
ref='/workspace/ref/typescript-go/internal/'
p=open(ref+'parser/parser.go').read().split('\n')
s=open(ref+'scanner/scanner.go').read().split('\n')
u=open(ref+'stringutil/util.go').read().split('\n')
def fn(lines,name):
    i=[k for k,l in enumerate(lines) if l.startswith('func '+name+'(')][0]
    j=i
    while not lines[j].startswith('}'): j+=1
    return '\n'.join(lines[i:j+1])
out=[open(__file__.replace('gen.py','prelude.go.txt')).read()]
for n in ['IsWhiteSpaceLike','IsWhiteSpaceSingleLine','IsLineBreak']: out.append(fn(u,n))
for n in ['isShebangTrivia','scanShebangTrivia','iterateCommentRanges']: out.append(fn(s,n))
for n in ['getCommentPragmas','extractPragmas','match','skipBlanks','skipNonBlanks','skipTo','lineEndPos','extractName','extractQuotedString']: out.append(fn(p,n))
src='\n\n'.join(out)
src=src.replace('ast.','').replace('core.','').replace('stringutil.','')
src=src.replace('scanner.GetLeadingCommentRanges(f, sourceText, 0)','iterateCommentRanges(f, sourceText, 0, false)')
src=src.replace('iter.Seq[CommentRange]','func(yield func(CommentRange) bool)')
src+=open(__file__.replace('gen.py','driver.go.txt')).read()
open(__file__.replace('gen.py','main.go'),'w').write(src)
