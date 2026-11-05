// m.cjs requires under a name that the build cannot follow, and its module object goes out of sight. What such a require may find grows while the build follows module objects:
// the exports of p/g.cjs, seen only through the object of p/late.cjs, lead to the loader of the package r. r/late.cjs is a child of m.cjs all the same, and r/g.cjs one of r/late.cjs.
import path from "node:path";
import "./m.cjs";
const held = globalThis.held;
for (const name of process.argv[2]?.split(",") ?? ["p", "r"]) held.exports.load(path.join(import.meta.dirname, ["node_modules", name, "late"].join("/") + ".cjs"));
const all = module => [module, ...module.children.flatMap(all)];
const key = process.argv[3] ?? "hidden";
for (const module of all(held)) {
  const found = module.exports[key];
  console.log(path.relative(import.meta.dirname, module.filename), typeof found === "function" ? found() : typeof found);
}
