// ES modules import compiled CommonJS modules (default, named, namespace and dynamic imports) and see the same exports as in plain Bun.
import whole, { alpha, beta, gamma } from "./plain.cjs";
import * as plain from "./plain.cjs";
import marked, { value as markedValue } from "./marked.cjs";
import * as markedNamespace from "./marked.cjs";
import replaced, { member } from "./replaced.cjs";
import * as replacedNamespace from "./replaced.cjs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
console.log(alpha, beta, gamma(1), Object.keys(whole).join(), whole === require("./plain.cjs"));
console.log(whole.alpha, whole.beta, whole.neverStored, whole.storedLater, whole.default, typeof whole.constructor, whole.hidden);
console.log(Object.keys(plain).join(), plain.default === whole, plain.alpha, typeof plain.gamma, plain.absent);
console.log("neverStored" in plain, plain.neverStored, "storedLater" in plain, typeof plain.constructor, plain.hidden);

const markedExports = require("./marked.cjs");
console.log(typeof marked, JSON.stringify(marked), markedValue, Object.keys(markedNamespace).join(), markedNamespace.__esModule, markedNamespace.hidden);
console.log(markedExports.__esModule, markedExports.value, markedExports.default === marked, markedExports.hidden, Object.keys(markedExports).join());

console.log(typeof replaced, replaced(), member, Object.keys(replacedNamespace).join(), replacedNamespace.default === replaced, replacedNamespace.lost);
console.log(Object.keys(replaced.original).join(), replaced.original.lost, replaced.original.member);

whole.alpha = "changed after the import";
whole.beta = 40;
whole.added = "added after the import";
whole.storeLater();
try {
  whole.hidden = "stored";
} catch (error) {
  console.log(error.constructor.name, whole.hidden);
}
console.log(alpha, beta, gamma(1), plain.alpha, plain.added, plain.storedLater, require("./plain.cjs").alpha);
console.log(whole.alpha, whole.beta, whole.added, whole.storedLater, Object.keys(whole).join());
const dynamic = await import("./plain.cjs");
console.log(dynamic === plain, dynamic.default === whole, Object.keys(dynamic).join());

const changed = whole.changeImportedLate();
const late = await import("./imported-late.cjs");
console.log(Object.keys(late).join(), late.default === changed, late.first, late.second, late.added, late.hidden, changed.hidden);
console.log(late.counted, changed.counted, late.counted, JSON.stringify(late.default));
