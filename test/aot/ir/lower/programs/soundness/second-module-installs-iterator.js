// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3
// CHECK-LABEL: function {{*}}name="use"

// FILE: main.js
import { Bag, show } from "./bag.js";
import { run } from "./late.js";
const b = new Bag();
function use(tag) { try { for (const x of b) show(tag, x); } catch (e) { show(tag, "not iterable"); } show(tag, b + 1); }
use("first");
run();
use("second");

// FILE: bag.js
function print(a, b, c) { let s = "" + a; if (b !== undefined) s += " " + b; if (c !== undefined) s += " " + c; console.log(s); }
function show(tag, v) {
  let t = typeof v;
  let extra = "";
  if (t === "number") extra = v + 1;
  else if (t === "string") extra = v + "!";
  else if (t === "object" && v !== null) extra = Object.keys(v).join(",");
  print(tag, t, extra);
}
export class Bag { constructor() { this.items = [1, 2]; } }
export { show };

// FILE: late.js
import { Bag } from "./bag.js";
export function run() {
  Bag.prototype[Symbol.iterator] = function* () { for (const x of this.items) yield "late" + x; };
  Bag.prototype.valueOf = function () { return 41; };
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
