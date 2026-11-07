// RUN: link
// CHECK: = PropGet {{*}}key="structuredClone" [isFreeName]
// CHECK: = PropGet {{*}}key="WeakMap" [isFreeName]

// RUN(LEFT): link
// LEFT-NOT: key="Date"
// LEFT-NOT: key="URL"
// LEFT-NOT: key="Map"

// RUN(PLACE): link
// OPTIONS(PLACE): runs-in-place
// PLACE: = PropGet {{*}}key="Date" [isFreeName]
// PLACE: = PropGet {{*}}key="structuredClone" [isFreeName]
// PLACE: = PropGet {{*}}key="WeakMap" [isFreeName]

// Nothing reads the variables. A name that is not locked may be a getter by now, or gone, or hold another class, and `bun build --compile` reads it, but for a name that its parser lists: it leaves `const when = Date;` and `URL;` out. `bun run` evaluates the declaration. Nothing can lie under `Map` but the class.
const when = Date;
structuredClone;
const table = new WeakMap();
URL;
const locked = Map;
const made = new Map();
console.log("ran");
