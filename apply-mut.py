#!/usr/bin/env python3
# Temporary instrumentation for mutation checks: each rule of the scan and of the second walk can be switched off with
# BUN_MUT=<n>. Apply, build debug, run /tmp/repro-9089/mut.sh <n...>, then `git checkout -- src/` and rebuild.
root='/workspace/bun/'
def sub(path, pairs):
    s=open(root+path).read()
    for a,b in pairs:
        assert s.count(a)==1, (path, a[:90], s.count(a))
        s=s.replace(a,b)
    open(root+path,'w').write(s)

sub('src/jsc/bindings/bindings.cpp', [
("// Whether `value` can lead a walk that collects to a matcher.",
 "static int bunMut()\n{\n    static int value = [] { const char* text = getenv(\"BUN_MUT\"); return text ? atoi(text) : 0; }();\n    return value;\n}\n\n// Whether `value` can lead a walk that collects to a matcher."),
# scan
("    if (!value || !value.isObject())\n        return false;\n    VM& vm = globalObject->vm();",
 "    if (!value || !value.isObject() || bunMut() == 18)\n        return false;\n    VM& vm = globalObject->vm();"),
("    bool isPlainArray = type == ArrayType && object->getPrototypeDirect() == globalObject->arrayPrototype();",
 "    bool isPlainArray = type == ArrayType && (bunMut() == 22 || object->getPrototypeDirect() == globalObject->arrayPrototype());"),
("    if ((!isPlainArray && !isPlainObject) || (!isCompiled && object->structure()->hasAnyKindOfGetterSetterProperties()) || !vm.isSafeToRecurse())\n        return true;",
 "    if (!isPlainArray && !isPlainObject)\n        return bunMut() != 21;\n    if ((!isCompiled && object->structure()->hasAnyKindOfGetterSetterProperties() && bunMut() != 20) || (!vm.isSafeToRecurse() && bunMut() != 23))\n        return true;"),
("        for (unsigned index = 0, length = butterfly->publicLength(); index < length; index++)\n            leads |= leadsToMatcher(",
 "        for (unsigned index = 0, length = bunMut() == 19 ? 0 : butterfly->publicLength(); index < length; index++)\n            leads |= leadsToMatcher("),
# walk
("    if (property.isPrivateName())\n        return;\n    // What the comparison left at this key before it failed.",
 "    if (property.isPrivateName() && bunMut() != 13)\n        return;\n    // What the comparison left at this key before it failed."),
("    if (row.value && !row.childPlace) {\n        state.recordIfAsked(obj, subsetObj, property, row.value, jsUndefined());\n        return;\n    }",
 "    if (row.value && !row.childPlace && bunMut() != 1) {\n        state.recordIfAsked(obj, subsetObj, property, row.value, jsUndefined());\n        return;\n    }"),
("    if (!subsetProp.isObject() || JSC::isTypedArrayType(subsetProp.asCell()->type()))\n        return;",
 "    if (!subsetProp.isObject() || (JSC::isTypedArrayType(subsetProp.asCell()->type()) && bunMut() != 3))\n        return;"),
("        if (obj == state.holderOfMatcherThatSaidNo && subsetObj == state.patternOfMatcherThatSaidNo && property == state.nameOfMatcherThatSaidNo)\n            return;",
 "        if (bunMut() == 2)\n            return;\n        if (bunMut() != 24 && obj == state.holderOfMatcherThatSaidNo && subsetObj == state.patternOfMatcherThatSaidNo && property == state.nameOfMatcherThatSaidNo)\n            return;"),
("    JSValue prop = row.childPlace ? row.value : JSValue();\n    if (!prop) {",
 "    if (bunMut() == 4)\n        row.childPlace = 0;\n    JSValue prop = row.childPlace ? row.value : JSValue();\n    if (!prop) {"),
("        if (scanned != state.patternLeadsToMatcher.end() && !scanned->value)\n            return;",
 "        if (scanned != state.patternLeadsToMatcher.end() && !scanned->value && bunMut() != 17)\n            return;"),
("        if (isExpectMatcher(prop) || !asymmetricMatchMethod(globalObject, prop) != !asymmetricMatchMethod(globalObject, subsetProp))\n            return;",
 "        if (bunMut() != 6 && (isExpectMatcher(prop) || !asymmetricMatchMethod(globalObject, prop) != !asymmetricMatchMethod(globalObject, subsetProp)))\n            return;"),
("    if (!state.seen.insert({ JSC::JSValue::encode(prop), JSC::JSValue::encode(subsetProp) }).second)\n        return;\n    uint32_t placeHere = state.place;",
 "    if (!state.seen.insert({ JSC::JSValue::encode(prop), JSC::JSValue::encode(subsetProp) }).second && bunMut() != 7)\n        return;\n    uint32_t placeHere = state.place;"),
# walker
("            if (auto verdict = runEqualityTesters(globalObject, throwScope, objValue, subsetValue)) {\n                if constexpr (collects) {",
 "            if (auto verdict = runEqualityTesters(globalObject, throwScope, objValue, subsetValue); verdict && !(collects && bunMut() == 11 && !throwScope.exception())) {\n                if constexpr (collects) {"),
("    // fast path for reference equality.\n    if (objValue == subsetValue) return true;",
 "    // fast path for reference equality.\n    if (objValue == subsetValue && !(collects && bunMut() == 5)) return true;"),
("            if (nodesEqual) {\n                if constexpr (collects) return true;\n                return *nodesEqual;\n            }",
 "            if (nodesEqual) {\n                if constexpr (collects) {\n                    if (bunMut() != 12) return true;\n                } else\n                    return *nodesEqual;\n            }"),
("                if (isStackOverflow(exception) || !throwScope.tryClearException())\n                    return false;",
 "                if (bunMut() == 8 || (isStackOverflow(exception) && bunMut() != 9) || !throwScope.tryClearException())\n                    return false;"),
("    if (!collects && vm.aotState().someClassHasPrivateNames) [[unlikely]] {",
 "    if ((!collects || bunMut() == 14) && vm.aotState().someClassHasPrivateNames) [[unlikely]] {"),
("                    if (state.records) [[unlikely]]\n                        recordMatcherThatSaidNo(state, obj, subsetObj, property, subsetProp);",
 "                    if (state.records && bunMut() != 25) [[unlikely]]\n                        recordMatcherThatSaidNo(state, obj, subsetObj, property, subsetProp);"),
])
sub('src/jsc/bindings/JestMatchedRows.cpp', [
("    if (scope.exception()) [[unlikely]] {\n        // The walk gave up: the stack ran out, or the two roots threw. The message gets the rows of the comparison.\n        // A termination stays.\n        (void)scope.tryClearException();\n        return rowsOfComparison;\n    }",
 "    if (scope.exception()) [[unlikely]] {\n        if (!(getenv(\"BUN_MUT\") && atoi(getenv(\"BUN_MUT\")) == 10))\n            (void)scope.tryClearException();\n        return rowsOfComparison;\n    }"),
])
sub('src/runtime/test_runner/expect.rs', [
("        let barrier = Pass::barrier();\n        let _entered = barrier.enter();\n        // SAFETY: `run` is the caller's own function, and `context` is what it takes.",
 "        let barrier = Pass::barrier();\n        #[allow(clippy::disallowed_methods)]\n        let _entered = (std::env::var(\"BUN_MUT\").as_deref() != Ok(\"16\")).then(|| barrier.enter());\n        // SAFETY: `run` is the caller's own function, and `context` is what it takes."),
])
print('applied')
