// Build prints: 1 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// The load follows an import() that is awaited where it stands. A promise that goes elsewhere takes the module out of sight.
import("node:worker_threads").then(threads => console.log(threads.isMainThread));
