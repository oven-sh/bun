import { createRequire } from "node:module";
const see = v =>
  v === null || (typeof v !== "object" && typeof v !== "function")
    ? String(v)
    : typeof v +
      " " +
      Object.keys(v).sort().join("+") +
      " default: " +
      (v.default === undefined ? "none" : typeof v.default + " " + Object.keys(v.default).sort().join("+"));
const load = createRequire(import.meta.url);
for (const name of [
  "./rt/literal.cjs",
  "./rt/names.cjs",
  "./rt/value.cjs",
  "./rt/function.cjs",
  "./rt/text.cjs",
  "./rt/literal-in-js.js",
  "./rt/names-in-js.js",
  "./rt/es.mjs",
  "./rt/es-in-js.js",
  "./rt/counts.cjs",
]) {
  try {
    console.log(name, see((load(name), await import(name))));
  } catch (e) {
    console.log(name, "THROWS", e.constructor.name);
  }
}
console.log((await import("./rt/counts.cjs")).default === load("./rt/counts.cjs"), load("./rt/counts.cjs").ran);
