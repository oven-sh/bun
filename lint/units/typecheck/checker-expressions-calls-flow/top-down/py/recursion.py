# Recursion of the twelve layers: the largest strongly connected component, self recursion, and the cycles through functions of
# the layers that stay when the tested entries are taken out of the graph. Edges: calls, function values, function-valued fields.
# The tested entries of the twelve layers are read from ../data/tested_entries.txt: the 54 names of ../../bottom-up/data/recursion.txt.
# usage: recursion.py [--without-printer]
import collections, os, sys
from zones import *
P = 'Checker.'
key = lambda f: (f['pkg'], f['q'])
graph = collections.defaultdict(set)
for f in fns:
    for c in f['callees']:
        if (c['pkg'], c['name']) in byname: graph[key(f)].add((c['pkg'], c['name']))
# Function-valued fields of the checker (checker.go:1252-1263 and NewChecker) and what they hold.
FIELD = {
 'markNodeAssignments': [('checker', P + 'markNodeAssignmentsWorker')],
 'couldContainTypeVariables': [('checker', P + 'couldContainTypeVariablesWorker')],
 'isStringIndexSignatureOnlyType': [('checker', P + 'isStringIndexSignatureOnlyTypeWorker')],
 'compareTypesAssignable': [('checker', P + 'compareTypesAssignableWorker')],
 'evaluate': [('checker', P + 'evaluateEntity')],
 'resolveName': [('binder', 'NameResolver.Resolve')],
 'resolveNameForSymbolSuggestion': [('binder', 'NameResolver.Resolve')],
}
for f in fns:
    for x in f['cfields']:
        for t in FIELD.get(x, []):
            if t in byname: graph[key(f)].add(t)
def sccs(nodes):
    index = {}; low = {}; stack = []; on = set(); comps = []; counter = [0]
    for v0 in sorted(nodes):
        if v0 in index: continue
        work = [(v0, iter(sorted(graph.get(v0, ()))))]
        index[v0] = low[v0] = counter[0]; counter[0] += 1; stack.append(v0); on.add(v0)
        while work:
            node, it = work[-1]
            adv = False
            for w in it:
                if w not in nodes: continue
                if w not in index:
                    index[w] = low[w] = counter[0]; counter[0] += 1; stack.append(w); on.add(w)
                    work.append((w, iter(sorted(graph.get(w, ())))))
                    adv = True; break
                elif w in on:
                    low[node] = min(low[node], index[w])
            if adv: continue
            work.pop()
            if work:
                p = work[-1][0]; low[p] = min(low[p], low[node])
            if low[node] == index[node]:
                comp = []
                while True:
                    w = stack.pop(); on.discard(w); comp.append(w)
                    if w == node: break
                comps.append(comp)
    return comps
comps = sccs(set(byname))
big = set(max(comps, key=len))
own = set(key(f) for f in fns if f['mine'])
HERE = os.path.dirname(os.path.abspath(__file__))
def sh(k): return short(byname[k])
if __name__ == '__main__':
    print('functions %d, largest component %d, functions of the layers %d, of them inside the largest component %d' % (len(byname), len(big), len(own), len(own & big)))
    for L in ORDER:
        fl = mine(L)
        inside = [f for f in fl if key(f) in big]
        print('== %s inside %d of %d' % (L, len(inside), len(fl)))
        print('outside: ' + ' '.join(short(f) for f in fl if key(f) not in big))
        print('self recursive: ' + ' '.join(short(f) for f in fl if key(f) in graph[key(f)]))
    # Entries that the sibling units test (checker-type-layers-topdown/py/recursion.py), with the entries they expect of this unit.
    SIB_OWN = '''getTypeOfSymbol getWriteTypeOfSymbol getTypeFromTypeNode instantiateTypeWithAlias resolveStructuredTypeMembers
 getUnionTypeEx getIntersectionTypeEx mapTypeEx getResolvedBaseConstraint getApparentType getBaseTypes
 getBaseConstructorTypeOfClass getReturnTypeOfSignature getTypePredicateOfSignature getDeclaredTypeOfSymbol
 getDeclaredTypeOfClassOrInterface getConditionalType getIndexedAccessTypeOrUndefined getIndexTypeEx getSimplifiedType
 getTemplateLiteralType getStringMappingType getWidenedTypeWithContext getRegularTypeOfObjectLiteral
 reportWideningErrorsInType getReducedType getTypeArguments getOuterTypeParameters getPropertyOfTypeEx
 getSignaturesOfType getPropertiesOfType getIndexInfosOfType getGenericObjectFlags couldContainTypeVariablesWorker
 getResolvedTypeParameterDefault getTypeForVariableLikeDeclaration getTypeFromBindingPattern getConstraintOfType
 getConstraintFromTypeParameter getSyntheticElementAccess getApparentTypeOfMappedType isValidTypeForTemplateLiteralPlaceholder
 isPatternLiteralPlaceholderType addTypeToIntersection getTypeWithThisArgument mayResolveTypeAlias isResolvedByTypeAlias
 getUnresolvedSymbolForEntityName getArrayElementTypeNode getIdentifierChain getImpliedConstraint
 getTupleElementLabelFromBindingElement getActualTypeVariable isNoInferTargetType getCombinedMappedTypeOptionality
 isValidIndexKeyType isLiteralOfContextualType allTypesAssignableToKindEx maybeTypeOfKind isEmptyObjectType
 addNamedUnions applyTargetStringMappingToSource isResolvingReturnTypeOfSignature getLowerBoundOfKeyType isKeyTypeIncluded
 isValidBaseType computeEnumMemberValues createNormalizedTupleTypeEx getRestType getTypeFromBindingElement
 getSiblingsOfContext isGenericReducibleType isMemberOfStringMapping isStringIndexSignatureOnlyTypeWorker'''.split()
    SIB_FREE = [('checker', 'getSymbolPath'), ('checker', 'isThislessType'), ('checker', 'getConstituentCount'), ('checker', 'TypeMapper.Map'), ('checker', 'CompareTypes')]
    SIB_OTHER = 'checkSourceElement checkDeferredNode isTypeRelatedTo checkTypeRelatedToEx inferTypes resolveAlias resolveEntityName getExportsOfModule getResolvedMembersOrExportsOfSymbol'.split()
    EXPECTED_OF_US = 'checkExpressionEx checkExpressionCachedEx getTypeOfExpression getFlowTypeOfReferenceEx getContextualType getTypeFacts getTypeWithFacts'.split()
    missing = [n for n in EXPECTED_OF_US if n not in open(HERE + '/../data/tested_entries.txt').read().split()]
    print('== entries that the type layers research expects of these layers and that the list lacks: ' + (' '.join(missing) or 'none'))
    MORE = open(HERE + '/../data/tested_entries.txt').read().split()
    S = set(SIB_FREE)
    for n in SIB_OWN + SIB_OTHER + MORE:
        k = ('checker', P + n) if ('checker', P + n) in byname else ('checker', n)
        if k not in byname: sys.exit('no such function: ' + n)
        S.add(k)
    DROP = set(k for k, f in byname.items() if f['zone'] in ('PRINTER', 'API-EMIT', 'API-SERVICES', 'API-EXPORTS', 'API-REFRESOLVER')) if '--without-printer' in sys.argv else set()
    rest = sccs(set(byname) - S - DROP)
    bad = [c for c in rest if (len(c) > 1 or c[0] in graph[c[0]]) and any(k in own for k in c)]
    print('== tested entries of the twelve layers (data/tested_entries.txt, the list of the bottom-up pass): %d' % len(MORE))
    print('== graph: ' + ('without the type printer, emitresolver.go, services.go, exports.go' if DROP else 'all functions of checker and binder'))
    print('== cycles through functions of the layers that pass no tested entry: %d' % len(bad))
    for c in sorted(bad, key=lambda c: (-len(c), sorted(c))):
        o = sorted(sh(k) + '[' + byname[k]['zone'] + ']' for k in c if k in own)
        x = sorted(sh(k) + '[' + byname[k]['zone'] + ']' for k in c if k not in own)
        print('%d own: %s | other: %s' % (len(c), ' '.join(o), ' '.join(x)[:1200]))
