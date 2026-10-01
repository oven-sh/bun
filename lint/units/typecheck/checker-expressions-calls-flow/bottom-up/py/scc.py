# Recursion table: which functions of the twelve layers must test the stack so that no call cycle stays untested.
import sys, os, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.setrecursionlimit(100000)
import layers as L
fns = L.fns; byname = L.byname
def key(f): return (f['pkg'], f['q'])
graph = collections.defaultdict(set)
for f in fns:
    for t, c in L.callees(f):
        graph[key(f)].add(key(t))
def sccs(nodes, removed=frozenset()):
    index = {}; low = {}; stack = []; on = set(); out = []; counter = [0]
    for v0 in sorted(nodes):
        if v0 in removed or v0 in index: continue
        work = [(v0, iter(sorted(graph.get(v0, ()))))]
        index[v0] = low[v0] = counter[0]; counter[0] += 1; stack.append(v0); on.add(v0)
        while work:
            node, it = work[-1]
            adv = False
            for w in it:
                if w not in nodes or w in removed: continue
                if w not in index:
                    index[w] = low[w] = counter[0]; counter[0] += 1; stack.append(w); on.add(w)
                    work.append((w, iter(sorted(graph.get(w, ()))))); adv = True; break
                elif w in on:
                    low[node] = min(low[node], index[w])
            if adv: continue
            work.pop()
            if work: low[work[-1][0]] = min(low[work[-1][0]], low[node])
            if low[node] == index[node]:
                comp = []
                while True:
                    w = stack.pop(); on.discard(w); comp.append(w)
                    if w == node: break
                out.append(comp)
    return out
allnodes = set(byname.keys())
# entries that other research units already listed as testing the stack (type layers, 77 names) and the core self-recursive functions
other_tested_names = set('''getTypeOfSymbol getWriteTypeOfSymbol getTypeFromTypeNode instantiateTypeWithAlias resolveStructuredTypeMembers getUnionTypeEx getIntersectionTypeEx mapTypeEx getResolvedBaseConstraint getApparentType getBaseTypes getBaseConstructorTypeOfClass getReturnTypeOfSignature getTypePredicateOfSignature getDeclaredTypeOfSymbol getDeclaredTypeOfClassOrInterface getConditionalType getIndexedAccessTypeOrUndefined getIndexTypeEx getSimplifiedType getTemplateLiteralType getStringMappingType getWidenedTypeWithContext getRegularTypeOfObjectLiteral reportWideningErrorsInType getReducedType getTypeArguments getOuterTypeParameters getPropertyOfTypeEx getSignaturesOfType getPropertiesOfType getIndexInfosOfType getGenericObjectFlags couldContainTypeVariablesWorker getResolvedTypeParameterDefault getTypeForVariableLikeDeclaration getTypeFromBindingPattern getConstraintOfType getConstraintFromTypeParameter getSyntheticElementAccess getApparentTypeOfMappedType isValidTypeForTemplateLiteralPlaceholder isPatternLiteralPlaceholderType addTypeToIntersection getTypeWithThisArgument mayResolveTypeAlias isResolvedByTypeAlias getUnresolvedSymbolForEntityName getArrayElementTypeNode getIdentifierChain getImpliedConstraint getTupleElementLabelFromBindingElement getActualTypeVariable isNoInferTargetType getCombinedMappedTypeOptionality isValidIndexKeyType isLiteralOfContextualType allTypesAssignableToKindEx maybeTypeOfKind isEmptyObjectType addNamedUnions applyTargetStringMappingToSource isResolvingReturnTypeOfSignature getLowerBoundOfKeyType isKeyTypeIncluded isValidBaseType computeEnumMemberValues createNormalizedTupleTypeEx getRestType getTypeFromBindingElement getSiblingsOfContext isGenericReducibleType isMemberOfStringMapping isStringIndexSignatureOnlyTypeWorker getSymbolPath isThislessType getConstituentCount
checkSourceElement checkDeferredNode isTypeRelatedTo checkTypeRelatedToEx inferTypes resolveAlias resolveEntityName getExportsOfModule getResolvedMembersOrExportsOfSymbol
isBlockScopedNameDeclaredBeforeUse isUsedInFunctionOrInstanceProperty getFullyQualifiedName isTypeReferenceWithGenericArguments getAliasDeclarationFromName CompareTypes compareTypeMappers tryGetPropertyAccessOrIdentifierToString isJSLiteralType requiresScopeChangeWorker'''.split())
other_tested = set(k for k in allnodes if (not byname[k]['mine']) and byname[k]['q'].split('.')[-1] in other_tested_names)
other_tested |= set(k for k in allnodes if byname[k]['q'] in ('TypeMapper.Map',))
# seed for the twelve layers: the seven entries other units count on, plus the flow workers and the walkers
seed_names = ['checkExpressionEx', 'checkExpressionCachedEx', 'getTypeOfExpression', 'getFlowTypeOfReferenceEx', 'getContextualType', 'getTypeFacts', 'getTypeWithFacts',
              'getTypeAtFlowNode', 'isReachableFlowNodeWorker', 'isPostSuperFlowNodeWorker', 'narrowType', 'markNodeAssignmentsWorker', 'isContextSensitive', 'getTypeFactsWorker']
mine = set(key(f) for f in fns if f['mine'])
tested = set(k for k in mine if byname[k]['q'].split('.')[-1] in seed_names)
def remaining(tested):
    removed = tested | other_tested
    cs = [c for c in sccs(allnodes, removed) if len(c) > 1 and any(k in mine for k in c)]
    selfs = [k for k in mine if k not in removed and k in graph[k]]
    return cs, selfs
while True:
    cs, selfs = remaining(tested)
    if not cs: break
    comp = max(cs, key=len); s = set(comp)
    cand = [k for k in comp if k in mine]
    def score(k):
        o = len([w for w in graph[k] if w in s]); i = len([v for v in s if k in graph[v]])
        return o * i
    pick = max(cand, key=score)
    tested.add(pick)
cs, selfs = remaining(tested)
print('functions of the twelve layers: %d; untested cycles left: %d' % (len(mine), len(cs)))
print('== entries of the twelve layers that test the stack (seed %d, then greedy): %d' % (len(seed_names), len(tested)))
for k in sorted(tested, key=lambda k: (L.ORDER.index(byname[k]['layer']), byname[k]['file'], byname[k]['decl'])):
    f = byname[k]
    print('  %s\t%s\t%s%s' % (f['layer'], L.loc(f), L.short(f), '\tseed' if f['q'].split('.')[-1] in seed_names else ''))
print('== self-recursive functions of the twelve layers outside that set (each tests the stack itself): %d' % len(selfs))
for k in sorted(selfs, key=lambda k: (L.ORDER.index(byname[k]['layer']), byname[k]['file'], byname[k]['decl'])):
    f = byname[k]
    print('  %s\t%s\t%s' % (f['layer'], L.loc(f), L.short(f)))
# how much of each layer sits in the big cycle of the whole checker
comps = sccs(allnodes)
big = set(max(comps, key=len))
print('== largest cycle of the whole package: %d functions; of the twelve layers inside it:' % len(big))
for lay in L.ORDER:
    fs = L.ours(lay)
    print('  %s %d of %d' % (lay, len([f for f in fs if key(f) in big]), len(fs)))
