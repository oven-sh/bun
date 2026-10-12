#pragma once

#include "root.h"

#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/WriteBarrier.h>
#include <span>
#include <wtf/Vector.h>

namespace Bun {

class LintHost;

// What ESLint's `SourceCode` needs, apart from the tokens. A member of LintHost.
struct LintSourceCodeState {
    void finishCreation(JSC::VM&, JSC::JSGlobalObject*, LintHost*);
    void endFile();

    // The nodes of the current file by their number, and where they are. The spans point into `buffer`.
    void setTree(JSC::VM&, LintHost*, JSC::JSArrayBuffer* buffer, JSC::JSArray* nodes, std::span<const uint32_t> starts, std::span<const uint32_t> ends, std::span<const uint32_t> parents);

    template<typename Visitor>
    void visit(Visitor& visitor)
    {
        visitor.append(constructor);
        visitor.append(instanceStructure);
        visitor.append(servicesStructure);
        visitor.append(program);
        visitor.append(scopeManager);
        visitor.append(comments);
        visitor.append(tokensAndComments);
        visitor.append(parserOptions);
        visitor.append(visitorKeys);
        visitor.append(lines);
        visitor.append(lineStartIndices);
        visitor.append(parserServices);
        visitor.append(treeBuffer);
        visitor.append(nodes);
    }

    // Built once.
    JSC::Identifier range, loc, parent, line, column;
    JSC::Identifier emitDecoratorMetadata, experimentalDecorators, isolatedDeclarations;
    JSC::WriteBarrier<JSC::JSObject> constructor;
    JSC::WriteBarrier<JSC::Structure> instanceStructure;
    JSC::WriteBarrier<JSC::Structure> servicesStructure;

    // Functions of the program in src/lint/js_plugin/worker, for the parts of a file that it still makes.
    JSC::WriteBarrier<JSC::JSObject> program;
    JSC::WriteBarrier<JSC::JSObject> scopeManager;
    JSC::WriteBarrier<JSC::JSObject> comments;
    JSC::WriteBarrier<JSC::JSObject> tokensAndComments;
    JSC::WriteBarrier<JSC::JSObject> parserOptions;
    // ESLint's `visitorKeys`, for typescript-estree and for espree.
    JSC::WriteBarrier<JSC::JSArray> visitorKeys;

    // Of the current file. Empty until a rule asks.
    JSC::WriteBarrier<JSC::JSArray> lines;
    JSC::WriteBarrier<JSC::JSArray> lineStartIndices;
    JSC::WriteBarrier<JSC::JSObject> parserServices;
    JSC::WriteBarrier<JSC::JSArrayBuffer> treeBuffer;
    JSC::WriteBarrier<JSC::JSArray> nodes;
    std::span<const uint32_t> starts;
    std::span<const uint32_t> ends;
    std::span<const uint32_t> parents;
    // By the number of a node: the number of the last node in it, or its own.
    WTF::Vector<uint32_t> lastDescendants;
};

// Adds `sourceCode`, `locGetter` and `locSetter` to the `native` object of the program in src/lint/js_plugin/worker.
void addLintSourceCodeFunctions(JSC::JSGlobalObject*, JSC::JSObject* native);

} // namespace Bun
