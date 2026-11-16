"use strict";
class Root { constructor() { this.w = 1; } }
class A extends Root { m(x) { return x + this.w; } }
class B extends Root { m(x) { return x * 2; } }
class D extends Root { m(x) { return x * x + 5; } }
class E extends Root { constructor() { super(); this.e = 5; } }
const make = k => n => k * 100 + n;
const ghost = new E();
ghost.m = make(10);
let count = 0;
function swap() { count++; ghost.m = make(10 + count); return 1; }
function use(thing, depth) { if (depth > 0) return use(thing, depth - 1) + 0; const got = thing.m(swap()); return got + 1; }
console.log(use(new A(), 1), use(new B(), 1), use(new D(), 1), use(ghost, 1), process.argv[2] ?? "");
