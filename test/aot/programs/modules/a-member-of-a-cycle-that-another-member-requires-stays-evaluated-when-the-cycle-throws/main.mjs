for (const [name, start] of [
  ["a", () => import("./a.mjs")],
  ["latex", () => import("./latex.mjs")],
  ["latey", () => import("./latey.mjs")],
  ["lateb", () => import("./lateb.mjs")],
]) await start().then(() => console.log(`import(${name}) resolves`), error => console.log(`import(${name}) rejects`, error.message));
