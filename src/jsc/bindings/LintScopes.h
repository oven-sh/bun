#pragma once

#include "root.h"

#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSWeakMap.h>
#include <JavaScriptCore/WriteBarrier.h>
#include <array>
#include <span>
#include <wtf/Vector.h>

namespace Bun {

// Whose objects the scopes of a file are. oxlint has those of typescript-eslint for every file, and adds the globals in its own way.
enum class LintScopeFlavor : uint8_t {
    TypeScript,
    EslintScope,
    Oxlint,
};

// How the objects of `eslint-scope`, or of `@typescript-eslint/scope-manager`, are laid out. It's the same for all files. A template is
// made when the first object needs it.
struct LintScopeLayout {
    // 18 kinds of scopes, 16 shapes of variables, 11 kinds of definitions, 2 shapes of references, `globalScope.implicit`, and
    // `reference.maybeImplicitGlobal`.
    static constexpr size_t templateCount = 18 + 16 + 11 + 2 + 1 + 1;

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
        globalSet.clear();
        knownGlobals.clear();
        mentionedGlobals.clear();
        mentionedNames.clear();
        mentionedAreOfLib.clear();
        quietLibVariables = 0;
        hasAllLibVariables = true;
    }

    // The caller holds the host's cell lock: `libNames` grows once.
    template<typename Visitor>
    void visit(Visitor& visitor)
    {
        visitor.append(globalSet);
        visitor.append(knownGlobals);
        visitor.append(mentionedGlobals);
        visitor.append(mentionedNames);
        visitor.append(lazyVariables);
        for (auto& it : libNames)
            visitor.append(it);
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

    // By `LintScopeFlavor`.
    std::array<LintScopeLayout, 3> layouts;
    LintScopeLayout& layoutOf(LintScopeFlavor flavor) { return layouts[static_cast<size_t>(flavor)]; }
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

    // The libraries of TypeScript can define thousands of variables, and most files ask for a few names. So only those that the file or
    // the configuration mentions are made with the scopes, the others when something asks for them.
    // `set` of the global scope. Plugins can write to it, so nothing is ever read from it. It's empty until all variables are made.
    JSC::WriteBarrier<JSC::JSMap> globalSet;
    // From the name to the variable, for those of the global scope that have been made. No plugin can reach it or the next two.
    JSC::WriteBarrier<JSC::JSMap> knownGlobals;
    // The variables of the global scope that were made with the scopes, in their order, their names, and whether each is one of a library.
    JSC::WriteBarrier<JSC::JSArray> mentionedGlobals;
    JSC::WriteBarrier<JSC::JSArray> mentionedNames;
    WTF::Vector<bool> mentionedAreOfLib;
    // How many of the others have been made.
    uint32_t quietLibVariables { 0 };
    // There are no others, or all have been made.
    bool hasAllLibVariables { true };
    // What's in `variables` of the global scope until it's read. It's the same for all files.
    JSC::WriteBarrier<JSC::JSCell> lazyVariables;
    // The names of what the libraries define, by their numbers. Empty until they are needed. They are the same for all files.
    WTF::Vector<JSC::WriteBarrier<JSC::JSString>> libNames;
};

} // namespace Bun
