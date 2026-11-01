// m.cjs requires under a name that the build cannot follow. Who requires whom is asked first for q/x.cjs, which reads module.parent. The object of q/index.cjs, kept for that, shows go(),
// which leads to the loader of the package p, and that one finds p/late.cjs by name. The parent of p/late.cjs is m.cjs, though it was found after the question was first asked.
import path from "node:path";
import { load } from "./m.cjs";
import { start } from "q";
console.log("above x.cjs:", start());
const late = load(path.join(import.meta.dirname, ["node_modules", "p", "late"].join("/") + ".cjs"));
console.log("above late.cjs:", late.who());
