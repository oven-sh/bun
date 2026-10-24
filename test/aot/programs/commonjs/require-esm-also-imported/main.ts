// An ES module is reached by `require` and by `import()`: it is evaluated once and both see the same bindings.
import { createRequire } from "node:module";
const order = process.argv[2] ?? "a";
if (order === "a") {
  const { viaRequire } = await import("./other.ts");
  console.log(viaRequire());
  const lib = await import("./lib.ts");
  console.log(lib.bump(), lib.count);
} else if (order === "b") {
  const lib = await import("./lib.ts");
  console.log(lib.bump());
  const { viaRequire } = await import("./other.ts");
  console.log(viaRequire(), lib.count);
} else if (order === "c") {
  const pending = import("./lib.ts");
  const { viaRequire } = await import("./other.ts");
  console.log(viaRequire());
  console.log((await pending).count);
} else if (order === "d") {
  const { lazy } = await import("./lazy.ts");
  console.log(lazy(), lazy());
} else if (order === "e") {
  const r = createRequire(import.meta.url);
  const { lazy } = await import("./lazy.ts");
  console.log(lazy());
  try { console.log(Object.keys(r(import.meta.dir + "/" + "nothing-there.js"))); } catch (e: any) { console.log("threw", e.code ?? e.name); }
}
