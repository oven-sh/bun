#pragma once

#include "root.h"

#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSWeakMap.h>
#include <JavaScriptCore/WriteBarrier.h>

namespace Bun {

// The scopes of the file that's being linted. A member of LintHost. All are null until a rule asks for the scopes.
struct LintScopeState {
    void endFile()
    {
        manager.clear();
        globalScope.clear();
        nodeToScope.clear();
        declaredVariables.clear();
    }

    template<typename Visitor>
    void visit(Visitor& visitor)
    {
        visitor.append(manager);
        visitor.append(globalScope);
        visitor.append(nodeToScope);
        visitor.append(declaredVariables);
    }

    // `sourceCode.scopeManager`
    JSC::WriteBarrier<JSC::JSObject> manager;
    JSC::WriteBarrier<JSC::JSObject> globalScope;
    // From the block of a scope to an array of the scopes that have it, outermost first.
    JSC::WriteBarrier<JSC::JSWeakMap> nodeToScope;
    // From a node to an array of the variables that it declares.
    JSC::WriteBarrier<JSC::JSWeakMap> declaredVariables;
};

} // namespace Bun
