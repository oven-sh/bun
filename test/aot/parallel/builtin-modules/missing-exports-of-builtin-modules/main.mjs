// An import of a name that a built-in module does not export is a SyntaxError when the module is linked.
const load = (name, start) =>
  start().then(
    () => console.log(name, "is loaded"),
    error => console.log(name, error.name + ": " + error.message),
  );
await load("crypto.mjs", () => import("./crypto.mjs"));
await load("stream.mjs", () => import("./stream.mjs"));
await load("without-prefix.mjs", () => import("./without-prefix.mjs"));
await load("renamed.mjs", () => import("./renamed.mjs"));
await load("unused.mjs", () => import("./unused.mjs"));
await load("typescript.ts", () => import("./typescript.ts"));
await load("export-from.mjs", () => import("./export-from.mjs"));
await load("imported-and-exported.mjs", () => import("./imported-and-exported.mjs"));
await load("sqlite.mjs", () => import("./sqlite.mjs"));
await load("constants.mjs", () => import("./constants.mjs"));
await load("process.mjs", () => import("./process.mjs"));
await load("existing.mjs", () => import("./existing.mjs"));
await load("types-are-dropped.ts", () => import("./types-are-dropped.ts"));
await load("namespace.mjs", () => import("./namespace.mjs"));
await load("bun.mjs", () => import("./bun.mjs"));
await load("process-debug-end.mjs", () => import("./process-debug-end.mjs"));
await load("process-getuid.mjs", () => import("./process-getuid.mjs"));
await load("constants-sigusr1.mjs", () => import("./constants-sigusr1.mjs"));
await load("constants-O_DIRECT.mjs", () => import("./constants-O_DIRECT.mjs"));
await load("constants-O_SYMLINK.mjs", () => import("./constants-O_SYMLINK.mjs"));
await load("constants-SIGBREAK.mjs", () => import("./constants-SIGBREAK.mjs"));
