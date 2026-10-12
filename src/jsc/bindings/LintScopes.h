#pragma once

#include "root.h"

#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSWeakMap.h>
#include <JavaScriptCore/WriteBarrier.h>
#include <array>
#include <span>
#include <wtf/Vector.h>

namespace Bun {

// How the objects of `eslint-scope`, or of `@typescript-eslint/scope-manager`, are laid out. It's the same for all files. A template is
// made when the first object needs it.
struct LintScopeLayout {
    // 18 kinds of scopes, 16 shapes of variables, 11 kinds of definitions, 2 shapes of references, and `globalScope.implicit`.
    static constexpr size_t templateCount = 18 + 16 + 11 + 2 + 1;

    // From src/lint/js_plugin/worker/scope.js: see `scopes` in LintScopes.cpp.
    JSC::WriteBarrier<JSC::JSArray> classes;
    // An object with the Structure of the objects, and with what is the same in all of them.
    std::array<JSC::WriteBarrier<JSC::JSObject>, templateCount> templates;
    // What goes into each property: a `Field`.
    std::array<WTF::Vector<uint8_t>, templateCount> programs;
};

// The scopes of the file that's being linted. A member of LintHost. All but the layouts are null until a rule asks for the scopes.
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
        visitor.append(strings);
        for (auto& layout : layouts) {
            visitor.append(layout.classes);
            for (auto& it : layout.templates)
                visitor.append(it);
        }
    }

    // For typescript-eslint and for eslint-scope.
    std::array<LintScopeLayout, 2> layouts;
    // `arguments`, the three settings of a global, the five kinds of a declaration.
    JSC::WriteBarrier<JSC::JSArray> strings;

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
