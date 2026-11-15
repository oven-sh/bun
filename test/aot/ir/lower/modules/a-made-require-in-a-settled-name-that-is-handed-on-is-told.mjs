// DIAGNOSTIC: TS100096 main.mjs:3
// DIAGNOSTIC: TS100096 main.mjs:4
// DIAGNOSTIC: TS100096 main.mjs:5
// DIAGNOSTIC: TS100096 main.mjs:6
// RUN: link
// CHECK: module {{*}}path="/$bunfs/root/part.cjs"

// FILE: main.mjs
// An argument, a field, an element and a store hand the require on. A call, a member that is read or called, a test and another settled name keep it in sight.
import { createRequire } from "node:module";
const given = createRequire(import.meta.url);
const boxed = createRequire(import.meta.url);
const listed = createRequire(import.meta.url);
const stored = createRequire(import.meta.url);
const kept = createRequire(import.meta.url);
const use = load => load("./part.cjs");
const box = { boxed };
const [first] = [listed];
globalThis.held = stored;
console.log(use(given), box.boxed("./part.cjs"), first("./part.cjs"), globalThis.held("./part.cjs"));
const again = kept;
console.log(kept("./part.cjs"), again("./part.cjs"), typeof kept.resolve, kept.call(null, "./part.cjs"), typeof kept);

// FILE: part.cjs
exports.value = "part";
