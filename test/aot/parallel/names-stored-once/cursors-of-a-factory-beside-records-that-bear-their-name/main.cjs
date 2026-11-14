"use strict";
const walker = require("./factory.cjs")({ scale: true });
function node(weight, marked, child, sibling) { return { weight, marked, child, sibling }; }
let tree = null;
for (let i = 0; i < 40; i++) tree = node(i, i % 8 === 0, i % 3 ? node(i * 2, false, null, null) : null, tree);
const root = node(1, true, tree, null);
const ref = { current: null }; const rootOfAll = { tag: 3, current: null, pending: 0 }; const queue = { current: 1, next: null }; const holder = { first: 1, second: 2, current: ref }; const fifth = { a: 1, b: 2, c: 3, current: 4 }; globalThis.kept = [ref, rootOfAll, queue, holder, fifth]; const n = +process.argv[2] || 10; let sum = 0;
for (let t = 0; t < n; t++) sum = (sum + walker.visit(root)) % 1000003;
console.log(sum, walker.depth());
