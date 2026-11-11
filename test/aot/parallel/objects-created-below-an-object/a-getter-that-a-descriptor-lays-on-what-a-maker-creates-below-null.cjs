"use strict";
function pick(one, other, first) { return first ? one : other; }
const plain = Object.create(null);
plain.size = 1;
plain.text = "plain";
const marked = Object.create(null);
marked.size = 2;
marked.text = "marked";
Object.defineProperty(marked, "shape", { get: function shape() { return this.text.length + this.size; } });
function show(first) { const picked = pick(plain, marked, first); return picked.text.length + picked.size + (picked.shape | 0); }
function f(t) { let s = 0; for (let i = 0; i < 100; i++) s += show((i & 1) === 0) + show((i & 1) === 1); return s + t; }
const n = +process.argv[2]; let sum = 0; for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000003; console.log(sum);
