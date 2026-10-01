#!/usr/bin/env python3
# Writes main.go: getCommentPragmas, extractPragmas and their helpers, processPragmasIntoFields, parseResolutionMode,
# parseErrorAt, parseErrorAtRange, iterateCommentRanges and the shebang and white space helpers, copied verbatim from
# /workspace/ref/typescript-go at run time, plus a driver that prints what finishSourceFile leaves in the source file.
# Usage: python3 gen.py && go run . inputs.json
import os
here=os.path.dirname(os.path.abspath(__file__))
ref='/workspace/ref/typescript-go/internal/'
p=open(ref+'parser/parser.go').read().split('\n')
s=open(ref+'scanner/scanner.go').read().split('\n')
u=open(ref+'stringutil/util.go').read().split('\n')
def fn(lines,name,method=False):
    pre='func (p *Parser) '+name+'(' if method else 'func '+name+'('
    i=[k for k,l in enumerate(lines) if l.startswith(pre)][0]
    j=i
    while not lines[j].startswith('}'): j+=1
    return '\n'.join(lines[i:j+1])
out=[open(os.path.join(here,'prelude.go.txt')).read()]
for n in ['IsWhiteSpaceLike','IsWhiteSpaceSingleLine','IsLineBreak']: out.append(fn(u,n))
for n in ['isShebangTrivia','scanShebangTrivia','iterateCommentRanges']: out.append(fn(s,n))
for n in ['getCommentPragmas','extractPragmas','match','skipBlanks','skipNonBlanks','skipTo','lineEndPos','extractName','extractQuotedString']: out.append(fn(p,n))
for n in ['processPragmasIntoFields','parseResolutionMode','parseErrorAt','parseErrorAtRange']: out.append(fn(p,n,True))
src='\n\n'.join(out)
src=src.replace('ast.','').replace('core.','').replace('stringutil.','').replace('diagnostics.','')
src=src.replace('scanner.GetLeadingCommentRanges(f, sourceText, 0)','iterateCommentRanges(f, sourceText, 0, false)')
src=src.replace('iter.Seq[CommentRange]','func(yield func(CommentRange) bool)')
# parseErrorAtRange of the reference makes a Diagnostic and sets hasParseError: the stand-in keeps the range and the code.
src=src.replace('result = NewDiagnostic(nil, loc, message, args...)','result = &Diagnostic{loc, message.code}')
src=src.replace('\tp.hasParseError = true\n','')
src=src.replace('p.len(p.diagnostics)','len(p.diagnostics)')
src+=open(os.path.join(here,'driver.go.txt')).read()
open(os.path.join(here,'main.go'),'w').write(src)
