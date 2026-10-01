# One layer and one landing step for every function of internal/checker and internal/binder.
# Base: ../../drivers-k4-k5/bottom-up/py/layermap.py (first match) and the 33 steps of ../../end-to-end-k4-k5/py/k3order.py.
# On top: the settlement of the ranges that two layer tables claim, and the pull-forwards.
# Input: the call graph fns.json of ../../checker-core-scratch/run.sh (default /tmp/k3a/fns.json).
# usage: python3 settle.py <out dir> [--check]
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '../../../drivers-k4-k5/bottom-up/py'))
from layermap import layer_of

FNS = os.environ.get('FNS_JSON', '/tmp/k3a/fns.json')
C = 'checker/checker.go'
ORDER = [
 (1, 'data model', ['TYPES', 'LINKS', 'MAPPER']),
 (2, 'utilities', ['UTIL']),
 (3, 'type keys, object types', ['T-KEYS', 'K-OBJ']),
 (4, 'resolution stack', ['T-RSTACK']),
 (5, 'init and globals', ['C-INIT', 'N-DIAG', 'D-SINK']),
 (6, 'symbol merging', ['S-MERGE']),
 (7, 'name resolution', ['N-RESOLVE']),
 (8, 'aliases and modules', ['A-ALIAS', 'M-MODULE', 'Q-ENTITY']),
 (9, 'literal, union, intersection', ['K-LIT', 'K-PRED', 'K-GENERIC', 'K-UNION', 'K-INTERSECT']),
 (10, 'tuples', ['T-TUPLE']),
 (11, 'declared types', ['T-DECLARED', 'T-ENUMVAL']),
 (12, 'type nodes to types', ['T-TYPENODE']),
 (13, 'constraints', ['T-CONSTRAINT']),
 (14, 'base types', ['T-BASE']),
 (15, 'members', ['T-MEMBERS', 'T-UIMEMBERS']),
 (16, 'lookup', ['T-LOOKUP']),
 (17, 'apparent types', ['T-APPARENT']),
 (18, 'signatures', ['T-SIGDECL', 'T-SIGSHAPE', 'T-SIGINST']),
 (19, 'instantiation', ['T-INSTANTIATE']),
 (20, 'types of symbols', ['T-SYMTYPE', 'T-JSDECL']),
 (21, 'widening', ['T-WIDEN']),
 (22, 'type printer', ['P-PRINT', 'checker:symboltracker.go', 'checker:nodecopy.go']),
 (23, 'relations', ['R-REL', 'R-DISCRIM', 'R-VARIANCE', 'R-SIGREL']),
 (24, 'elaboration', ['R-ELAB']),
 (25, 'expressions to contextual', ['E-CORE', 'E-LITERAL', 'E-OPER', 'E-ACCESS', 'E-COLLIDE', 'E-FACTS', 'E-FUNC', 'T-RETINFER', 'E-CALL', 'I-INFER', 'I-REVMAP', 'E-CTX']),
 (26, 'flow, reachability', ['F-NARROW', 'F-REACH']),
 (27, 'keyof to template', ['K-KEYOF', 'K-INDEXED', 'K-SUBST', 'K-COND', 'T-MAPPED', 'K-TEMPLATE', 'K-IMPORTTYPE']),
 (28, 'iteration, async', ['D-ITER', 'E-AWAIT']),
 (29, 'JSX', ['X-JSX']),
 (30, 'decorators', ['E-DECOR', 'D-DECOR']),
 (31, 'declaration checks', ['D-DRIVER', 'D-VAR', 'D-CLASS', 'D-ENUMNS', 'D-IMPEXP', 'D-FUNC', 'D-STMT', 'D-TYPENODE', 'D-JSDOC', 'D-HELPERS', 'U-ALIASMARK']),
 (32, 'unused, unreachable', ['D-UNUSED', 'F-UNREACH']),
 (33, 'grammar', ['G-GRAMMAR']),
]
STEP = {layer: step for step, _, layers in ORDER for layer in layers}
OUT_OF_SCOPE = {'Z-SERVICES', 'checker:tracer.go', 'checker:nodebuilder_hover.go', 'checker:stringer_generated.go'}

# The ranges of checker.go that two layer tables claim: (first, last, claimants, settled layer, reason).
DOUBLE = [
 (2398, 2477, 'D-DRIVER, F-UNREACH', 'D-DRIVER', 'checkSourceElementWorker (2271) runs it for every source element and the run of `const x: number = "s";` enters both; callees land by step 26'),
 (8833, 8888, 'E-CALL, E-DECOR', 'E-DECOR', 'resolveDecorator calls getDecoratorCallSignature of E-DECOR; entered for a Decorator node only'),
 (9273, 9302, 'E-CALL, E-DECOR', 'E-CALL', 'hasCorrectArity (9223) calls it; its callees land by step 18'),
 (10171, 10197, 'E-FUNC, D-HELPERS', 'D-HELPERS', 'calls checkExternalEmitHelpers of D-HELPERS; a class expression waits for D-CLASS anyway'),
 (10935, 10943, 'E-OPER, E-AWAIT', 'E-AWAIT', 'calls checkAwaitedType of E-AWAIT; entered for an AwaitExpression node only'),
 (11995, 12037, 'E-ACCESS, R-REL', 'R-REL', 'Relater.propertyRelatedTo (relater.go 4318) calls isValidOverrideOf; the callees land by step 16'),
 (13208, 13219, 'E-OPER, R-REL', 'R-REL', 'Relater.reportRelationError (relater.go 4818, 4830) and elaborateElement call them; the callees land by step 20'),
 (18151, 18162, 'T-SYMTYPE, T-JSDECL', 'T-SYMTYPE', 'getTypeOfVariableOrParameterOrPropertyWorker (16675) calls it for every prototype property; callees land by step 11'),
 (18164, 18344, 'T-SYMTYPE, T-JSDECL', 'T-JSDECL', 'JavaScript assignment declarations: ported whole in step 20, the callees of steps 25 to 27 are stand-ins until then'),
 (18346, 18350, 'T-SYMTYPE, T-JSDECL', 'T-SYMTYPE', 'widenTypeForVariableLikeDeclaration (18356) calls it; callee getSymbolOfNode lands in step 6'),
 (29124, 29133, 'T-SIGSHAPE, E-AWAIT', 'T-SIGSHAPE', 'two leaves over getTypeAtPosition of T-SIGSHAPE'),
 (29924, 29930, 'E-CTX, E-DECOR', 'E-DECOR', 'calls getDecoratorCallSignature of E-DECOR; entered for a Decorator node only'),
]
# A function that no layer table lists: (first, last, layer, reason).
UNOWNED = [
 (24805, 24818, 'Z-SERVICES', 'getGlobalImportMetaExpressionType: its one caller is getSymbolAtLocation (31717, call at 31762) of the language service part'),
]
# A layer or a range that lands at another step than the step of its layer: (file, first, last, layer, step, verdict, reason).
LANDING = [
 (C, 29268, 29344, 'K-TEMPLATE', 9, 'accepted', 'getTemplateLiteralType and getTemplateStringForType: NewChecker (1019) makes numericStringType with them; a stand-in shifts every later type id by one'),
 (C, 25075, 25125, 'K-SUBST', 12, 'accepted', 'getConditionalFlowTypeOfType, getImpliedConstraint, isUnaryTupleTypeNode: getTypeFromTypeNode (22921) passes every type node through them'),
 (C, 31694, 31702, 'K-SUBST', 12, 'accepted', 'getActualTypeVariable: callee of getConditionalFlowTypeOfType'),
 (C, 27988, 28023, 'R-REL', 23, 'accepted', 'getNormalizedType group: isRelatedToEx (relater.go 2649) normalizes both sides of every relation'),
 (C, 28163, 28248, 'R-REL', 23, 'accepted', 'getNormalizedUnionOrIntersectionType .. getSingleBaseForNonAugmentingSubtype: callees of getNormalizedType, entered by the same run'),
 (C, 14052, 14168, 'D-SINK', 5, 'accepted', 'addDiagnostic, error and the deferred callbacks: the sink of every layer from initializeChecker on'),
 (C, 28025, 28033, 'K-INDEXED', 13, 'accepted', 'getSimplifiedType (plan of the type layers): getResolvedBaseConstraint (27588) calls it for every constrained type; its two branches are stand-ins until steps 27'),
 ('checker/relater.go', 94, 96, 'R-REL', 13, 'accepted', 'asRecursionId (plan of the type layers): callee of getRecursionIdentity'),
 ('checker/relater.go', 810, 870, 'R-REL', 13, 'accepted', 'getRecursionIdentity, getRecursionIdentityTarget, getRecursionIdentityFromTarget (plan of the type layers): getResolvedBaseConstraint calls them'),
 (C, 16587, 16656, 'T-SYMTYPE', 15, 'accepted', 'getTypeOfSymbol .. getTypeOfVariableOrParameterOrProperty (plan of the type layers): the dispatcher serves every symbol whose type is set at creation; the workers are stand-ins until step 20'),
 (C, 13950, 13964, 'E-ACCESS', 15, 'accepted', 'isReadonlySymbol (plan of the type layers): createUnionOrIntersectionProperty (21622) reads it for every property'),
 (C, 21829, 22005, 'T-APPARENT', 16, 'accepted', 'T-APPARENT lands with T-LOOKUP (plan of the type layers): every lookup starts with getReducedApparentType'),
 ('checker/inference.go', 1, 1684, 'I-INFER', 25, 'rejected', 'inference directly after elaboration: the order of the unit file keeps inference after calls and overloads; the run of `const x: number = "s";` enters one function of the file (isSkipDirectInferenceNode)'),
]

def settled_layer(file, line):
    if file == C:
        for first, last, _, layer, _ in DOUBLE:
            if first <= line <= last:
                return layer
        for first, last, layer, _ in UNOWNED:
            if first <= line <= last:
                return layer
    return layer_of(file, line)

def landing_step(file, line, layer):
    for f, first, last, lay, step, verdict, _ in LANDING:
        if verdict == 'accepted' and f == file and first <= line <= last:
            return step
    return STEP.get(layer)

def main():
    out_dir = sys.argv[1]
    fns = json.load(open(FNS))
    by_name = {f['name']: f for f in fns}
    rows, unplaced = [], []
    for f in fns:
        if f['pkg'] not in ('checker', 'binder'):
            continue
        layer = settled_layer(f['file'], f['decl'])
        step = landing_step(f['file'], f['decl'], layer)
        if f['pkg'] == 'binder' and layer != 'N-RESOLVE':
            layer, step = 'BINDER', 0
        if step is None:
            if layer in OUT_OF_SCOPE or layer.startswith('checker:') and layer in OUT_OF_SCOPE:
                step = 99
            else:
                unplaced.append((f['file'], f['decl'], f['name'], layer)); step = -1
        rows.append((f['file'], f['decl'], f['end'], f['name'], layer, step))
    rows.sort()
    text = 'file\tfirst line\tlast line\tfunction\tlayer\tlanding step (0 binder, 99 out of scope)\n' + ''.join('\t'.join(map(str, r)) + '\n' for r in rows)

    # The rule behind DOUBLE: the earlier claimant gets the range when every callee of the range lands by its step.
    step_of = {r[3]: r[5] for r in rows}
    check = []
    for first, last, claimants, layer, reason in DOUBLE:
        steps = sorted((STEP[c.strip()], c.strip()) for c in claimants.split(','))
        early_step, early = steps[0]
        callee_max, latest = 0, ''
        names = []
        for f in fns:
            if f['file'] == C and first <= f['decl'] <= last:
                names.append(f['name'].replace('checker.Checker.', ''))
                for callee in (f.get('callees') or []):
                    g = by_name.get(callee)
                    if not g or g['pkg'] != 'checker' or callee.startswith('checker.Type.') or first <= g['decl'] <= last and g['file'] == C:
                        continue
                    s = step_of.get(callee, 0)
                    if 0 < s < 99 and s > callee_max:
                        callee_max, latest = s, callee.replace('checker.Checker.', '')
        by_rule = early if callee_max <= early_step else steps[-1][1]
        if steps[0][0] == steps[-1][0]:
            # Both claimants land in the same step: the rule does not tell them apart, the label follows the caller.
            by_rule = layer
        check.append((f'{first}-{last}', ', '.join(names), claimants, layer, str(landing_step(C, first, layer)), by_rule,
                      f'{callee_max} ({latest})' if latest else '0', reason))
    settlement = 'lines of checker.go\tfunctions\tclaimed by\tsettled layer\tlanding step\tlayer by the rule\tlatest callee step\treason\n'
    settlement += ''.join('\t'.join(r) + '\n' for r in check)
    settlement += '\nlines of checker.go\tlayer\treason (no layer table lists the function)\n'
    settlement += ''.join(f'{a}-{b}\t{lay}\t{reason}\n' for a, b, lay, reason in UNOWNED)
    settlement += '\nfile\tlines\tlayer\tlanding step\tverdict\treason\n'
    settlement += ''.join(f'{f}\t{a}-{b}\t{lay}\t{step}\t{verdict}\t{reason}\n' for f, a, b, lay, step, verdict, reason in LANDING)

    # Every accepted pull-forward has a caller that lands at or before its step.
    callers = {}
    for f in fns:
        for callee in (f.get('callees') or []):
            callers.setdefault(callee, []).append(f['name'])
    unproven = []
    for f_, first, last, lay, step, verdict, _ in LANDING:
        if verdict != 'accepted':
            continue
        inside = [f for f in fns if f['file'] == f_ and first <= f['decl'] <= last]
        ok = any(0 < step_of.get(caller, 0) <= step for f in inside for caller in callers.get(f['name'], [])
                 if not (by_name[caller]['file'] == f_ and first <= by_name[caller]['decl'] <= last))
        if not ok:
            unproven.append(f'{f_} {first}-{last}')

    counts = {}
    for r in rows:
        counts[r[5]] = counts.get(r[5], 0) + 1
    summary = ''.join(f'{step:2d} {title:32s} {counts.get(step, 0):5d} functions\n' for step, title, _ in ORDER)
    summary += f' 0 binder                           {counts.get(0, 0):5d} functions\n99 out of scope                   {counts.get(99, 0):5d} functions\n'
    summary += f'unplaced: {len(unplaced)}\n' + ''.join(f'  {u}\n' for u in unplaced)
    mism = [c for c in check if c[3] != c[5]]
    summary += f'pull-forwards without a caller at or before their step: {len(unproven)} {unproven}\n'
    summary += f'settled layer differs from the rule: {len(mism)}\n' + ''.join(f'  {m[0]} settled {m[3]} rule {m[5]}\n' for m in mism)

    # PORT_STATUS rows: one row for each run of functions of one layer in one upstream file.
    split = []
    for l in open(os.path.join(HERE, '../../../checker-core-scratch/data/split.tsv')):
        parts = l.rstrip('\n').split('\t')
        if len(parts) >= 5 and '-' in parts[1]:
            a, b = parts[1].split('-')
            split.append((int(a), int(b), parts[4]))
    def module_of(file, line):
        if file == C:
            for a, b, name in split:
                if a <= line <= b:
                    return 'checker/' + name
        return file[:-3] + '.rs'
    status, run = [], None
    for file, first, last, name, layer, step in rows:
        short = name.split('.', 1)[1] if '.' in name else name
        short = short.replace('Checker.', '')
        key = (file, layer, step, module_of(file, first))
        if run and run[0] == key:
            run[2] = last; run[3] += 1; run[5] = short
        else:
            if run:
                status.append(run)
            run = [key, first, last, 1, short, short]
    if run:
        status.append(run)
    port = 'upstream path\tlines\tlayer\tlanding step\tfunctions\tfirst .. last\tRust module\tstate\tcommit\n'
    for (file, layer, step, module), first, last, count, a, b in status:
        names = a if count == 1 else f'{a} .. {b}'
        port += f'internal/{file}\t{first}-{last}\t{layer}\t{step}\t{count}\t{names}\t{module}\tnot started\t89d5d5b\n'
    summary += f'PORT_STATUS rows: {len(status)}\n'

    files = {'functions-by-layer.tsv': text, 'layer-settlement.tsv': settlement, 'functions-by-step.txt': summary, 'port-status-rows.tsv': port}
    if '--check' in sys.argv:
        ok = all(open(os.path.join(out_dir, n)).read() == t for n, t in files.items())
        print('layer tables:', 'no diff' if ok else 'DIFFER', f'{len(rows)} functions, {len(unplaced)} unplaced')
        sys.exit(0 if ok and not unplaced else 1)
    for n, t in files.items():
        open(os.path.join(out_dir, n), 'w').write(t)
    print(summary, end='')

main()
