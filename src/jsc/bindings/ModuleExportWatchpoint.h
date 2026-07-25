// Reusable watchpoint on a built-in module's exported property so native code
// can branch on "has the user replaced this export?" with a single word read.
//
// Motivation: Node's loader machinery reads several of its hooks through
// mutable module exports (fs.readFileSync, Module._resolveFilename,
// Module.wrapper, ...). Bun fast-paths past those hooks natively, so it needs
// a cheap way to know when one has been replaced and fall back to calling it.
//
// This wraps JSC's ObjectPropertyChangeAdaptiveWatchpoint, the same primitive
// JSGlobalObject uses to guard Array.prototype.join and friends. Installing
// one creates an Equivalence condition ("exports.<name> is still <original>")
// and wires both the per-offset replacement watchpoint and the
// structure-transition watchpoint into an InlineWatchpointSet, so plain
// assignment, Object.defineProperty, attribute changes, and delete all
// invalidate it. The fast-path check is `isStillOriginal()`, which is one
// load and compare.
//
// The export remains a plain data property, so spyOn / getOwnPropertyDescriptor
// behave exactly as they do in Node.
//
// To track another export: add a `ModuleExportWatchpoint m_<mod><Prop>;`
// member to the global object and call `install()` from the module's
// initialization after the exports object is fully populated.

#pragma once

#include "root.h"
#include <JavaScriptCore/ObjectPropertyChangeAdaptiveWatchpoint.h>
#include <JavaScriptCore/ObjectPropertyCondition.h>
#include <JavaScriptCore/Watchpoint.h>

namespace Bun {

class ModuleExportWatchpoint {
public:
    ALWAYS_INLINE bool isStillOriginal() const { return m_set.isStillValid(); }

    void install(JSC::JSGlobalObject*, JSC::JSObject* exports, const JSC::Identifier& prop);

private:
    JSC::InlineWatchpointSet m_set { JSC::IsWatched };
    std::unique_ptr<JSC::ObjectPropertyChangeAdaptiveWatchpoint<JSC::InlineWatchpointSet>> m_adaptor;
};

} // namespace Bun
