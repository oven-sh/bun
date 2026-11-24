"use strict";
const names = [];
function other(target, name) { names.push(name); return String(name).length; }
class Handler { constructor(trap) { this.get = trap; this.has = this.has.bind({ answer: false }); } get(target, name) { return -1; } has(target, name) { return this.answer ?? true; } }
const proxy = new Proxy({}, new Handler(other)), turns = +(process.argv[2] ?? 50);
let s = 0; for (let i = 0; i < turns; i++) s += proxy.abc + proxy["k" + i];
console.log(s, names.length, "x" in proxy);
