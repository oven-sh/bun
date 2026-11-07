// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 5

// FILE: main.ts
// `const { kValue } = require("./keys.cjs")`, where keys.cjs makes one literal of symbols and stores it into module.exports: the idiom of many packages for their private names.
// The names are constants for whoever reads them while nothing has been stored under them again, and every other way through the same modules gives what plain JavaScript gives.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const out: string[] = [];
const suffix = process.argv[2] ?? "";
const hide = new Function("value", "return value" + suffix) as <V>(value: V) => V;
const storeUnseen = new Function("object", "key", "value", "object[key] = value" + suffix) as (object: object, key: PropertyKey, value: unknown) => void;

const keys = require("./keys.cjs");
const Thing = require("./thing.cjs");
const things: any[] = [];
for (let i = 0; i < 6; i++) things.push(hide(new Thing(i)));
for (let i = 0; i + 1 < things.length; i++) things[i].link(things[i + 1]);
let sum = 0;
for (let turn = 0; turn < 500; turn++) for (const thing of things) sum += thing.touch();
out.push(`sum ${sum}, count ${things[3].count()}, length ${things[0].length()} ${things[4].length()}`);
out.push("own symbols: " + Object.getOwnPropertySymbols(things[0]).map(String).join());
out.push("own names: " + JSON.stringify(Object.keys(things[0])) + " " + JSON.stringify(things[0]));
out.push(`through the literal: ${things[2][keys.kValue]} ${things[2][keys.kCount]} ${things[2][keys.kNext] === things[3]}`);
out.push(`the same literal again: ${require("./keys.cjs") === keys} ${Object.keys(keys).join()}`);
out.push(`another symbol of the same description finds nothing: ${things[2][Symbol("thing.value")]}`);

storeUnseen(things[1], keys.kValue, "stored by code that nobody sees");
delete things[2][keys.kCount];
Object.defineProperty(things[3], keys.kValue, { get: () => "from a getter", configurable: true });
out.push(`after changes: ${things[1].touch()} | ${things[2].touch()} ${things[2].count()} | ${things[3].touch()} | ${things[4].touch()}`);

const replacement = Symbol("replacement");
keys.kChanged = replacement;
storeUnseen(keys, "kAdded", Symbol("added"));
delete keys.kRemoved;
const marked = hide(new Thing("marked"));
marked[replacement] = "under the replacement";
out.push("a module loaded after the literal has changed: " + require("./late.cjs")(marked));

const cycle = require("./cycle.cjs");
out.push(`a module that requires itself: early ${cycle.early} | late ${cycle.late()} | ${String(cycle.kInside)}`);
const kept = require("./first-object-kept.cjs");
out.push(`the first exports object: ${Object.keys(kept).join()} | ${Object.keys(kept.first).join()} | ${String(kept.first.onFirst)} | ${kept.isThis} | ${kept.first === kept}`);
console.log(out.join("\n"));

// FILE: cycle.cjs
"use strict";
// The helper requires this module while its body runs, so it meets the first exports object.
function look() {
  const seen = require("./cycle.cjs");
  return [typeof seen, Object.keys(seen).join(), seen === module.exports, typeof seen.kInside].join(" ");
}
const early = look();
module.exports = { kInside: Symbol("inside"), early, late: look };

// FILE: first-object-kept.cjs
"use strict";
// The first exports object is used before another value takes its place, and afterwards.
const first = exports;
exports.onFirst = Symbol("on the first object");
module.exports = { kSecond: Symbol("second"), first, isThis: this === first };
first.afterwards = 1;

// FILE: keys.cjs
"use strict";
const keys = {
  kValue: Symbol("thing.value"),
  kCount: Symbol("thing.count"),
  kNext: Symbol("thing.next"),
  kChanged: Symbol("thing.changed"),
};
module.exports = keys;

// FILE: late.cjs
"use strict";
// Loaded after somebody has stored another value under a name of the literal.
const { kChanged, kValue, kAdded, kRemoved } = require("./keys.cjs");
module.exports = function describe(object) {
  return [typeof kChanged, String(kChanged), typeof kAdded, String(kAdded), typeof kRemoved, object[kChanged], object[kValue]].join(" | ");
};

// FILE: thing.cjs
"use strict";
const { kValue, kCount, kNext } = require("./keys.cjs");
function Thing(value) {
  this[kValue] = value;
  this[kCount] = 0;
  this[kNext] = null;
}
Thing.prototype.touch = function () {
  this[kCount]++;
  return this[kValue];
};
Thing.prototype.count = function () {
  return this[kCount];
};
Thing.prototype.link = function (next) {
  this[kNext] = next;
  return this;
};
Thing.prototype.length = function () {
  let length = 0;
  for (let thing = this; thing !== null; thing = thing[kNext]) length++;
  return length;
};
module.exports = Thing;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: get
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="from a getter"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
