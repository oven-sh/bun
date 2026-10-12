#pragma once

#include "root.h"

#include "LintPropertyCache.h"
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/JSWeakMap.h>
#include <JavaScriptCore/WriteBarrier.h>
#include <span>
#include <wtf/Vector.h>

namespace Bun {

class LintHost;

// What ESLint's `SourceCode` needs, apart from the tokens. A member of LintHost.
struct LintSourceCodeState {
    void finishCreation(JSC::VM&, JSC::JSGlobalObject*, LintHost*);
    void endFile();

    // The nodes of the current file by their number, and where they are. The spans point into `buffer`, or into memory that Rust keeps
    // until the file is done if `buffer` is null.
    void setTree(JSC::VM&, LintHost*, JSC::JSArrayBuffer* buffer, JSC::JSArray* nodes, std::span<const uint32_t> starts, std::span<const uint32_t> ends, std::span<const uint32_t> parents);

    template<typename Visitor>
    void visit(Visitor& visitor)
    {
        range.visit(visitor);
        loc.visit(visitor);
        parent.visit(visitor);
        type.visit(visitor);
        visitor.append(locGetter);
        visitor.append(scopeCache);
        visitor.append(constructor);
        visitor.append(instanceStructure);
        visitor.append(servicesStructure);
        visitor.append(problemStructure);
        visitor.append(directiveStructure);
        visitor.append(directivesStructure);
        visitor.append(commentsStructure);
        visitor.append(inlineConfigNodes);
        visitor.append(disableDirectives);
        visitor.append(program);
        visitor.append(scopeManager);
        visitor.append(parserOptions);
        visitor.append(visitorKeys);
        visitor.append(lines);
        visitor.append(lineStartIndices);
        visitor.append(parserServices);
        visitor.append(treeBuffer);
        visitor.append(nodes);
    }

    // Built once.
    LintPropertyCache range, loc, parent, type;
    JSC::Identifier line, column, start, end, value, body, properties, elements, cases, commentsName;
    JSC::Identifier functionExpressionScope, childScopes, upper, block, variables, set, get, defs, references, identifier, eslintUsed;
    JSC::Identifier emitDecoratorMetadata, experimentalDecorators, isolatedDeclarations;
    // The getter of `loc` that nodes and tokens inherit.
    JSC::WriteBarrier<JSC::JSObject> locGetter;
    // By node: what `getScope` has found.
    JSC::WriteBarrier<JSC::JSWeakMap> scopeCache;
    JSC::WriteBarrier<JSC::JSObject> constructor;
    JSC::WriteBarrier<JSC::Structure> instanceStructure;
    JSC::WriteBarrier<JSC::Structure> servicesStructure;
    // `{ ruleId, message, loc }`, `{ type, node, value, justification }` and `{ problems, directives }`
    JSC::WriteBarrier<JSC::Structure> problemStructure;
    JSC::WriteBarrier<JSC::Structure> directiveStructure;
    JSC::WriteBarrier<JSC::Structure> directivesStructure;
    // `{ leading, trailing }`
    JSC::WriteBarrier<JSC::Structure> commentsStructure;

    // Functions of the program in src/lint/js_plugin/worker, for the parts of a file that it still makes.
    JSC::WriteBarrier<JSC::JSObject> program;
    JSC::WriteBarrier<JSC::JSObject> scopeManager;
    JSC::WriteBarrier<JSC::JSObject> parserOptions;
    // ESLint's `visitorKeys`, for typescript-estree and for espree.
    JSC::WriteBarrier<JSC::JSArray> visitorKeys;

    // Of the current file. Empty until a rule asks.
    JSC::WriteBarrier<JSC::JSArray> lines;
    JSC::WriteBarrier<JSC::JSArray> lineStartIndices;
    JSC::WriteBarrier<JSC::JSObject> parserServices;
    JSC::WriteBarrier<JSC::JSArray> inlineConfigNodes;
    JSC::WriteBarrier<JSC::JSObject> disableDirectives;
    // What src/lint/js_plugin/directives.rs writes for each of `inlineConfigNodes`.
    struct ConfigComment {
        uint32_t comment, label, valueStart, valueEnd, justificationStart, justificationEnd;
    };
    std::span<const ConfigComment> configComments;
    JSC::WriteBarrier<JSC::JSArrayBuffer> treeBuffer;
    JSC::WriteBarrier<JSC::JSArray> nodes;
    std::span<const uint32_t> starts;
    std::span<const uint32_t> ends;
    std::span<const uint32_t> parents;
    // By the number of a node: the number of the last node in it, or its own.
    WTF::Vector<uint32_t> lastDescendants;
};

// `nodeOrToken.loc`
JSC::JSValue lintLocOf(JSC::JSGlobalObject*, LintHost*, JSC::JSValue nodeOrToken);

// Adds `sourceCode`, `locGetter` and `locSetter` to the `native` object of the program in src/lint/js_plugin/worker.
void addLintSourceCodeFunctions(JSC::JSGlobalObject*, JSC::JSObject* native);

} // namespace Bun
