# Prints the marked function lists of the printer family, per file in upstream order.
# Marks: K = executed by the minimal K4 case, D = executed by checker diagnostics of the corpus,
# X = executed only when declaration diagnostics are added (the declaration transform, nothing printed),
# E = executed only by emit, declaration emit or the type and symbol baselines, N = never executed by the corpus.
# usage: python3 marked.py <family.tsv> [marks, default KD]
import sys,csv,collections
rows=list(csv.DictReader(open(sys.argv[1]),delimiter='\t'))
want=sys.argv[2] if len(sys.argv)>2 else 'KD'
def mark(r):
    if int(r.get('k4_covered',0))>0: return 'K'
    if int(r['diag_covered'])>0: return 'D'
    if int(r.get('diagdecl_covered',0))>0: return 'X'
    if int(r['full_covered'])>0: return 'E'
    return 'N'
per=collections.OrderedDict()
for r in rows:
    per.setdefault(r['file'],[]).append(r)
for file,rs in per.items():
    rs.sort(key=lambda r:int(r['start']))
    c=collections.Counter(mark(r) for r in rs)
    l=collections.Counter()
    for r in rs: l[mark(r)]+=int(r['lines'])
    print("## %s: %d functions, %d lines; K %d/%d D %d/%d E %d/%d N %d/%d (functions/lines)"%(file,len(rs),sum(int(r['lines']) for r in rs),c['K'],l['K'],c['D'],l['D'],c['E'],l['E'],c['N'],l['N'])+" X %d/%d"%(c['X'],l['X']))
    out=[]
    for r in rs:
        m=mark(r)
        if m not in want: continue
        name=r['id'].split('.',1)[1]
        for p in ('NodeBuilderImpl.','Printer.','Checker.','EmitContext.','PseudoChecker.'):
            if name.startswith(p): name=name[len(p):] if p!='Checker.' else 'c.'+name[len(p):]
        out.append("%s%s@%s"%(m+':' if len(want)>1 else '',name,r['start']))
    print(' '.join(out))
