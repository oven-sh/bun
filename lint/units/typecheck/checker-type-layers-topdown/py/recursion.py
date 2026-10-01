# Recursion of the layers: membership of the largest strongly connected component, self recursion, and the cycles
# that stay when the functions of CHECKED (entries that test the stack) are taken out of the graph.
import collections, sys
from layers import *
P = 'checker.Checker.'
graph = collections.defaultdict(set)
for f in fns:
    for c in f['callees']:
        if c in byname: graph[f['name']].add(c)
# Calls through the function-valued fields of initializeClosures (checker.go:1252-1263).
FIELD_CALLS = [
 ('instantiateTypeWithAlias', 'couldContainTypeVariablesWorker'), ('instantiateSymbol', 'couldContainTypeVariablesWorker'),
 ('couldContainTypeVariablesWorker', 'couldContainTypeVariablesWorker'), ('getObjectTypeInstantiation', 'couldContainTypeVariablesWorker'),
 ('getIndexedAccessTypeOrUndefined', 'isStringIndexSignatureOnlyTypeWorker'),
 ('isStringIndexSignatureOnlyTypeWorker', 'isStringIndexSignatureOnlyTypeWorker'),
]
for a, b in FIELD_CALLS: graph[P + a].add(P + b)
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
own = set(f['name'] for f in fns if f['layer'] in IDX)
print('functions %d, largest component %d, functions of the layers %d, of them inside the largest component %d' % (len(byname), len(big), len(own), len(own & big)))
for L in ORDER:
    fl = mine(L)
    inside = [short(f['name']) for f in fl if f['name'] in big]
    selfrec = [short(f['name']) for f in fl if f['name'] in graph[f['name']]]
    print('== %s inside %d of %d' % (L, len(inside), len(fl)))
    print('outside: ' + ' '.join(short(f['name']) for f in fl if f['name'] not in big))
    print('self recursive: ' + ' '.join(selfrec))
# Entries of the layers that test the stack.
CHECKED_OWN = ['getTypeOfSymbol', 'getWriteTypeOfSymbol', 'getTypeFromTypeNode', 'instantiateTypeWithAlias', 'resolveStructuredTypeMembers',
 'getUnionTypeEx', 'getIntersectionTypeEx', 'mapTypeEx', 'getResolvedBaseConstraint', 'getApparentType', 'getBaseTypes',
 'getBaseConstructorTypeOfClass', 'getReturnTypeOfSignature', 'getTypePredicateOfSignature', 'getDeclaredTypeOfSymbol',
 'getDeclaredTypeOfClassOrInterface', 'getConditionalType', 'getIndexedAccessTypeOrUndefined', 'getIndexTypeEx', 'getSimplifiedType',
 'getTemplateLiteralType', 'getStringMappingType', 'getWidenedTypeWithContext', 'getRegularTypeOfObjectLiteral',
 'reportWideningErrorsInType', 'getReducedType', 'getTypeArguments', 'getOuterTypeParameters', 'getPropertyOfTypeEx',
 'getSignaturesOfType', 'getPropertiesOfType', 'getIndexInfosOfType', 'getGenericObjectFlags', 'couldContainTypeVariablesWorker',
 'getResolvedTypeParameterDefault', 'getTypeForVariableLikeDeclaration', 'getTypeFromBindingPattern', 'getConstraintOfType',
 'getConstraintFromTypeParameter', 'getSyntheticElementAccess', 'getApparentTypeOfMappedType', 'isValidTypeForTemplateLiteralPlaceholder',
 'isPatternLiteralPlaceholderType', 'addTypeToIntersection', 'getTypeWithThisArgument', 'mayResolveTypeAlias', 'isResolvedByTypeAlias',
 'getUnresolvedSymbolForEntityName', 'getArrayElementTypeNode', 'getIdentifierChain', 'getImpliedConstraint',
 'getTupleElementLabelFromBindingElement', 'getActualTypeVariable', 'isNoInferTargetType', 'getCombinedMappedTypeOptionality',
 'isValidIndexKeyType', 'isLiteralOfContextualType', 'allTypesAssignableToKindEx', 'maybeTypeOfKind', 'isEmptyObjectType',
 'addNamedUnions', 'applyTargetStringMappingToSource', 'isResolvingReturnTypeOfSignature', 'getLowerBoundOfKeyType', 'isKeyTypeIncluded',
 'isValidBaseType', 'computeEnumMemberValues', 'createNormalizedTupleTypeEx', 'getRestType', 'getTypeFromBindingElement',
 'getSiblingsOfContext', 'isGenericReducibleType', 'isMemberOfStringMapping', 'isStringIndexSignatureOnlyTypeWorker']
CHECKED_FREE = ['checker.getSymbolPath', 'checker.isThislessType', 'checker.getConstituentCount']
# Entries of other layers that are taken as tested there.
CHECKED_OTHER = ['checkExpressionEx', 'checkExpressionCachedEx', 'checkSourceElement', 'checkDeferredNode', 'getTypeOfExpression',
 'getFlowTypeOfReferenceEx', 'getContextualType', 'isTypeRelatedTo', 'checkTypeRelatedToEx', 'inferTypes', 'getTypeFacts',
 'getTypeWithFacts', 'resolveAlias', 'resolveEntityName', 'getExportsOfModule', 'getResolvedMembersOrExportsOfSymbol']
S = set(['checker.TypeMapper.Map', 'checker.CompareTypes'] + CHECKED_FREE)
for n in CHECKED_OWN + CHECKED_OTHER:
    if P + n not in byname: sys.exit('no such function: ' + n)
    S.add(P + n)
# Functions whose only cycle is a method value handed to mapType: the call happens inside mapTypeEx, which tests the stack.
BY_CALLBACK = ['getRegularTypeOfLiteralType', 'getBaseTypeOfLiteralType', 'getBaseTypeOfLiteralTypeUnion', 'getBaseTypeOfLiteralTypeForComparison',
 'getWidenedLiteralType', 'getWidenedUniqueESSymbolType']
rest = sccs(set(byname) - S)
bad = [c for c in rest if (len(c) > 1 or c[0] in graph[c[0]]) and any(k in own for k in c)]
bad = [c for c in bad if not all(k in own and k[len(P):] in BY_CALLBACK for k in c)]
print('== entries of the layers that test the stack: %d' % (len(CHECKED_OWN) + len(CHECKED_FREE)))
print(' '.join(CHECKED_OWN + [short(n) for n in CHECKED_FREE]))
print('== entries of other layers taken as tested: ' + ' '.join(CHECKED_OTHER + ['TypeMapper.Map', 'CompareTypes']))
print('== recursion only through a method value handed to mapType, tested in mapTypeEx: ' + ' '.join(BY_CALLBACK))
print('== cycles through functions of the layers that pass no tested entry: %d' % len(bad))
for c in sorted(bad, key=lambda c: (-len(c), sorted(c))):
    print('%d own: %s | other: %s' % (len(c), ' '.join(sorted(short(k) for k in c if k in own)), ' '.join(sorted(short(k) for k in c if k not in own))[:400]))
