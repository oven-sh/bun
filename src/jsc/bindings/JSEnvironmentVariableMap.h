#include "root.h"
#include "SharedEnvStore.h"

namespace Zig {
class GlobalObject;
}

namespace JSC {
class JSValue;
struct ClassInfo;
}

namespace Bun {

JSC::JSValue createEnvironmentVariablesMap(Zig::GlobalObject* globalObject);

// True when `info` is one of the process.env backing classes (JSProcessEnv or
// JSSharedEnvMap). Structured clone treats them as plain objects.
bool isProcessEnvClassInfo(const JSC::ClassInfo* info);

// worker_threads SHARE_ENV: a `process.env` whose reads/writes/enumeration go
// through the SharedEnvStore of the tree its global belongs to.
JSC::JSValue createSharedEnvironmentVariablesMap(Zig::GlobalObject* globalObject);

// Resolve the SHARE_ENV store for a worker spawned from `globalObject`: the
// spawning thread's existing store if it has one, otherwise a fresh store seeded
// from its `process.env` (which is then swapped to a write-through view).
// Returns null if seeding threw.
RefPtr<SharedEnvStore> ensureSharedEnvStoreForWorker(Zig::GlobalObject* globalObject);

}
