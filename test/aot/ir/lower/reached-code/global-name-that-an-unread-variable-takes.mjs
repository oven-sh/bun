// RUN: link
// CHECK: = PropGet {{*}}key="Date" [isFreeName]
// CHECK: = PropGet {{*}}key="structuredClone" [isFreeName]
// CHECK: = PropGet {{*}}key="WeakMap" [isFreeName]

// RUN(LEFT): link
// LEFT-NOT: key="URL"
// LEFT-NOT: key="Map"

// Nothing reads the variables. A name that is not locked may be a getter by now, or gone, or hold another class, and `bun run` reads it. It leaves `URL;` out, and nothing can lie under `Map` but the class.
const when = Date;
structuredClone;
const table = new WeakMap();
URL;
const locked = Map;
const made = new Map();
console.log("ran");
