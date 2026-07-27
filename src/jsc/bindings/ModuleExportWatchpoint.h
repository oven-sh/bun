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
// load and compare. The export remains a plain data property, so spyOn /
// getOwnPropertyDescriptor behave exactly as they do in Node.
//
// To track another export: add a `TrackedExport` enum entry and a row to
// `s_trackedExportTable`. `InternalModuleRegistry` installs the watchpoint
// automatically when that module first evaluates; modules write nothing.

#pragma once

#include "root.h"
#include <JavaScriptCore/ObjectPropertyChangeAdaptiveWatchpoint.h>
#include <JavaScriptCore/ObjectPropertyCondition.h>
#include <JavaScriptCore/Watchpoint.h>
#include "InternalModuleRegistry.h"

namespace Zig {
class GlobalObject;
}

namespace Bun {

class ModuleExportWatchpoint {
public:
    ALWAYS_INLINE bool isStillOriginal() const { return m_set.isStillValid(); }

    void install(JSC::JSGlobalObject*, JSC::JSObject* exports, const JSC::Identifier& prop);

private:
    JSC::InlineWatchpointSet m_set { JSC::IsWatched };
    std::unique_ptr<JSC::ObjectPropertyChangeAdaptiveWatchpoint<JSC::InlineWatchpointSet>> m_adaptor;
};

enum class TrackedExport : uint8_t {
    FsReadFileSync,

    Count
};

struct TrackedExportEntry {
    InternalModuleRegistry::Field module;
    ASCIILiteral prop;
    TrackedExport slot;
};

static constexpr TrackedExportEntry s_trackedExportTable[] = {
    { InternalModuleRegistry::Field::NodeFS, "readFileSync"_s, TrackedExport::FsReadFileSync },
};
static_assert(std::size(s_trackedExportTable) == static_cast<size_t>(TrackedExport::Count));

// Called from InternalModuleRegistry after a built-in module first evaluates.
// Installs a watchpoint for each table row that belongs to `id`.
void installTrackedExportsForModule(Zig::GlobalObject*, InternalModuleRegistry::Field id, JSC::JSValue exports);

// Read the current value of a tracked export from its module's exports object.
// Returns an empty JSValue when the module has not evaluated or the property
// is missing. No side effects beyond the property get on the exports object.
JSC::JSValue currentValueOfTrackedExport(Zig::GlobalObject*, TrackedExport slot);

} // namespace Bun
