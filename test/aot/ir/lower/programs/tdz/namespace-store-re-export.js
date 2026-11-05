// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3
// CHECK-LABEL: function {{*}}name="note"
// CHECK-LABEL: function {{*}}name="tell"

// FILE: main.js
// A store to a binding that was imported through a re-export.
import * as ns from "./m.js";
const log = []; const note = (x) => (log.push(x), x);
const tell = (name, f) => { try { const r = f(); console.log(name + ": " + (typeof r === "function" ? "function" : String(r))); } catch (e) { console.log(name + ": threw " + e.name); } };
import * as mid from "./mid.js";
tell("first", () => ns.inside());
for (const V of [7, 1.5, "text", { a: 9 }, () => "second", null, undefined]) {
  log.length = 0;
  tell("the store", () => { mid.inner.k = note(V); });
  tell("evaluated", () => log.map((x) => typeof x === "function" ? "function" : typeof x === "object" && x ? "object" : String(x)).join());
  tell("outside", () => typeof ns.k);
  tell("inside", () => ns.inside());
  tell("hot", () => ns.hot());
}

// FILE: m.js
export const k = () => "first";
export const inside = () => { try { return typeof k === "function" ? (k.who ? k.who() : k()) : typeof k === "object" ? "object " + k.a : "value " + (k + 1); } catch (e) { return "threw " + e.name; } };
export function hot() { let r; for (let i = 0; i < 50; i++) r = inside(); return r; }

// FILE: mid.js
export * as inner from "./m.js";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
