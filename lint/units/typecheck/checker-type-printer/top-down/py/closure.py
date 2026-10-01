# Classifies the printer family top-down: K (minimal K4 case), D (executed by checker diagnostics of the corpus),
# P (not executed by the corpus, ported with its caller: small, or reachable by real input), S (stand-in that logs),
# O (no ported caller: omitted). Input: the call graph and coverage table of the bottom-up pass.
# usage: python3 closure.py <fns.json.gz> <family.tsv> <out dir>
import json,gzip,csv,collections,sys,re
fns=json.load(gzip.open(sys.argv[1]))
byid={f['id']:f for f in fns}
fam={r['id']:r for r in csv.DictReader(open(sys.argv[2]),delimiter='\t')}
out=sys.argv[3]
def mark(r):
    if int(r.get('k4_covered',0))>0: return 'K'
    if int(r['diag_covered'])>0: return 'D'
    return None
marks={i:mark(r) for i,r in fam.items()}
# stand-in roots: entry functions of subsystems that checker diagnostics cannot reach or that need a host that is out of scope
S_EXACT=set('''
checker.EmitResolver.aliasMarkingVisitorWorker checker.EmitResolver.isValueAliasDeclarationWorker
checker.NodeBuilderImpl.isExpandableType checker.NodeBuilderImpl.walkNodeForExpandability
modulespecifiers.GetAllowedEndingsInPreferredOrder modulespecifiers.getLocalModuleSpecifier modulespecifiers.tryGetModuleNameAsNodeModule modulespecifiers.IsExcludedByRegex
printer.EmitContext.GetNodeForGeneratedName printer.EmitContext.SourceMapRange printer.EmitContext.TokenSourceMapRange printer.EmitContext.AssignCommentAndSourceMapRanges printer.EmitContext.GetTypeNode
printer.GeneratedIdentifierFlags.IsNode printer.NameGenerator.generateNameForNodeCached printer.NameGenerator.makeName printer.NameGenerator.MakeFileLevelOptimisticUniqueName
printer.Printer.getEffectiveLines printer.Printer.shouldWriteComment printer.Printer.getUniqueHelperName printer.Printer.emitDecorator
printer.Printer.emitPropertyDeclaration printer.Printer.emitMethodDeclaration printer.Printer.emitClassStaticBlockDeclaration printer.Printer.emitConstructor
printer.Printer.emitJSDocAllType printer.Printer.emitJSDocNonNullableType printer.Printer.emitJSDocNullableType printer.Printer.emitJSDocOptionalType printer.Printer.emitJSDocVariadicType
printer.Printer.emitArrayLiteralExpression printer.Printer.emitObjectLiteralExpression printer.Printer.emitCallExpression printer.Printer.emitNewExpression printer.Printer.emitTaggedTemplateExpression
printer.Printer.emitTypeAssertionExpression printer.Printer.emitParenthesizedExpression printer.Printer.emitFunctionExpression printer.Printer.emitArrowFunction printer.Printer.emitDeleteExpression
printer.Printer.emitTypeOfExpression printer.Printer.emitVoidExpression printer.Printer.emitAwaitExpression printer.Printer.emitPostfixUnaryExpression printer.Printer.emitBinaryExpression
printer.Printer.emitConditionalExpression printer.Printer.emitTemplateExpression printer.Printer.emitYieldExpression printer.Printer.emitSpreadElement printer.Printer.emitClassExpression
printer.Printer.emitAsExpression printer.Printer.emitSatisfiesExpression printer.Printer.emitNonNullExpression printer.Printer.emitMetaProperty printer.Printer.emitPartiallyEmittedExpression
printer.Printer.emitRegularExpressionLiteral
printer.Printer.emitTemplateSpan printer.Printer.emitSemicolonClassElement printer.Printer.emitVariableDeclaration printer.Printer.emitVariableDeclarationList printer.Printer.emitModuleBlock printer.Printer.emitCaseBlock
printer.Printer.emitImportClause printer.Printer.emitNamespaceImport printer.Printer.emitNamedImports printer.Printer.emitImportSpecifier printer.Printer.emitNamespaceExport printer.Printer.emitNamedExports printer.Printer.emitExportSpecifier
printer.Printer.emitStatement printer.Printer.emitExternalModuleReference printer.Printer.emitCaseClause printer.Printer.emitDefaultClause printer.Printer.emitHeritageClause printer.Printer.emitCatchClause
printer.Printer.emitPropertyAssignment printer.Printer.emitShorthandPropertyAssignment printer.Printer.emitSpreadAssignment printer.Printer.emitEnumMember printer.Printer.emitJSDocNode printer.Printer.emitSourceFile
printer.Printer.emitLeadingCommentsOfNode printer.Printer.emitTrailingCommentsOfNode printer.Printer.emitLeadingSyntheticCommentsOfNode printer.Printer.emitTrailingSyntheticCommentsOfNode
printer.Printer.shouldEmitCommentIfTripleSlash printer.Printer.shouldEmitNewLineBeforeLeadingCommentOfPosition printer.Printer.emitComments printer.Printer.emitComment printer.Printer.emitSourcePos
printer.Printer.isFileLevelUniqueNameInCurrentFile printer.Printer.emitFunctionBody
printer.encodeJsxCharacterEntity printer.escapeJsxAttributeString printer.getLinesBetweenRangeEndAndRangeStart printer.getLinesBetweenPositionAndPrecedingNonWhitespaceCharacter
printer.getLinesBetweenPositionAndNextNonWhitespaceCharacter printer.siblingNodePositionsAreComparable printer.newLineCharacterCache
'''.split())
S_PREFIX=('printer.Printer.emitJsx',)
# another implementation of the writer interface, used by the language service only
O_PREFIX=('printer.ChangeTrackerWriter.',)
# the three writers that the checker uses implement the whole writer interface
W_PREFIX=('printer.textWriter.','printer.singleLineStringWriter.','printer.trailingSemicolonDeferringWriter.','printer.NewTextWriter','printer.GetSingleLineStringWriter','printer.getTrailingSemicolonDeferringWriter','printer.getIndentString')
def is_s(i): return i in S_EXACT or any(i.startswith(p) for p in S_PREFIX)
unknown=[x for x in S_EXACT if x not in fam]
assert not unknown, unknown
cls={i:m for i,m in marks.items() if m}
# close the ported set over family callees: a callee that is not K/D becomes S when it is a stand-in root, else P (and its callees are followed)
work=list(cls)
while work:
    i=work.pop()
    if cls[i]=='S': continue
    for c in byid[i].get('calls',[]):
        if c.startswith('iface:') or c not in fam or c in cls or any(c.startswith(p) for p in O_PREFIX): continue
        cls[c]='S' if is_s(c) else 'P'
        work.append(c)
# the pseudochecker has no checker dependency: it is ported whole
for i in fam:
    if i.startswith('pseudochecker.') and cls.get(i) not in ('K','D'): cls[i]='P'
for i in fam:
    if any(i.startswith(p) for p in W_PREFIX) and cls.get(i) not in ('K','D'): cls[i]='P'
for i in fam:
    cls.setdefault(i,'O')
cnt=collections.Counter(cls.values()); lines=collections.Counter()
for i,c in cls.items(): lines[c]+=int(fam[i]['lines'])
print({k:(cnt[k],lines[k]) for k in 'KDPSO'})
per=collections.OrderedDict()
for i,r in fam.items(): per.setdefault(r['file'],[]).append(i)
def short(i):
    n=i.split('.',1)[1]
    for p in ('NodeBuilderImpl.','Printer.','EmitContext.','PseudoChecker.'):
        if n.startswith(p): n=n[len(p):]
    if n.startswith('Checker.'): n='c.'+n[len('Checker.'):]
    return n
with open(out+'/closure.tsv','w') as o:
    o.write('id\tfile\tstart\tlines\tclass\n')
    for f,ids in per.items():
        for i in sorted(ids,key=lambda i:int(fam[i]['start'])):
            o.write('%s\t%s\t%s\t%s\t%s\n'%(i,f,fam[i]['start'],fam[i]['lines'],cls[i]))
with open(out+'/closure-by-file.txt','w') as o:
    for f,ids in per.items():
        ids=sorted(ids,key=lambda i:int(fam[i]['start']))
        c=collections.Counter(cls[i] for i in ids); l=collections.Counter()
        for i in ids: l[cls[i]]+=int(fam[i]['lines'])
        o.write('## %s: %d functions, %d lines; %s\n'%(f,len(ids),sum(int(fam[i]['lines']) for i in ids),' '.join('%s %d/%d'%(k,c[k],l[k]) for k in 'KDPSO')))
        for k,title in (('P','ported with the caller'),('S','stand-ins')):
            xs=[short(i)+'@'+fam[i]['start'] for i in ids if cls[i]==k]
            if xs: o.write('%s (%s): %s\n'%(k,title,' '.join(xs)))
        print('%-38s %s'%(f,' '.join('%s %3d/%5d'%(k,c[k],l[k]) for k in 'KDPSO')))
