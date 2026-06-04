#include "root.h"

namespace Zig {
class GlobalObject;
}

namespace JSC {
class JSValue;
}

namespace Bun {

JSC::JSValue createEnvironmentVariablesMap(Zig::GlobalObject* globalObject);

// worker_threads SHARE_ENV: a `process.env` whose reads/writes/enumeration go
// through a process-wide shared store.
JSC::JSValue createSharedEnvironmentVariablesMap(Zig::GlobalObject* globalObject);

// Seed the shared store from the parent's current `process.env` and swap the
// parent's `process.env` to the shared, write-through variant. Idempotent.
void enableSharedEnvForWorker(Zig::GlobalObject* globalObject);

}
