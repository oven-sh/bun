#pragma once

#include "root.h"

#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSWeakMap.h>
#include <JavaScriptCore/WriteBarrier.h>
#include <span>

namespace Bun {

// The scopes of the file that's being linted. A member of LintHost. All are null until a rule asks for the scopes.
struct LintScopeState {
    void endFile()
    {
        manager.clear();
        globalScope.clear();
        nodeToScope.clear();
        declaredVariables.clear();
        variables.clear();
        variableWords = {};
        declaredCount = 0;
    }

    template<typename Visitor>
    void visit(Visitor& visitor)
    {
        visitor.append(manager);
        visitor.append(globalScope);
        visitor.append(nodeToScope);
        visitor.append(declaredVariables);
        visitor.append(variables);
    }

    // `sourceCode.scopeManager`
    JSC::WriteBarrier<JSC::JSObject> manager;
    JSC::WriteBarrier<JSC::JSObject> globalScope;
    // From the block of a scope to an array of the scopes that have it, outermost first.
    JSC::WriteBarrier<JSC::JSWeakMap> nodeToScope;
    // From a node to an array of the variables that it declares.
    JSC::WriteBarrier<JSC::JSWeakMap> declaredVariables;

    // The variables as src/lint/js_plugin/scopes.rs numbers them, and what it says about each. The first `declaredCount` are those
    // that the file declares.
    JSC::WriteBarrier<JSC::JSArray> variables;
    std::span<const uint32_t> variableWords;
    uint32_t declaredCount { 0 };
};

} // namespace Bun
