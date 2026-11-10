// DIAGNOSTIC: TS100096 main.mjs:4
// DIAGNOSTIC: TS100096 main.mjs:6
// DIAGNOSTIC: TS100096 main.mjs:7
// DIAGNOSTIC: TS100096 main.mjs:9
// DIAGNOSTIC: TS100096 main.mjs:11
// DIAGNOSTIC: TS100096 main.mjs:13
// DIAGNOSTIC: TS100096 main.mjs:17
// DIAGNOSTIC: TS100096 main.mjs:19
// RUN: link
// CHECK: module {{*}}path="/$bunfs/root/part.cjs"

// FILE: main.mjs
// A field, a parameter, an element, an exported name, `&&=`, a holder that is stored into another, a holder that holds another function too, a base that only the run knows.
import { createRequire } from "node:module";
const made = () => import.meta.url;
const box = { held: createRequire(import.meta.url) };
const use = held => held("./part.cjs");
console.log(box.held("./part.cjs"), use(createRequire(import.meta.url)));
const [element] = [createRequire(import.meta.url)];
export let exported;
exported = createRequire(import.meta.url);
let both = true;
both &&= createRequire(import.meta.url);
let first;
first = createRequire(import.meta.url);
let second;
second = first;
let other;
other = createRequire(import.meta.url);
other = name => name;
console.log(createRequire(process.argv[2])("./part.cjs"), element, both, second, other, made);
const settled = createRequire(import.meta.url);
let late;
try {
  late = createRequire(import.meta.url);
} catch {}
console.log(settled("./part.cjs"), late("./part.cjs"), typeof createRequire(process.argv[2]), typeof settled.resolve);

// FILE: part.cjs
exports.value = "part";
