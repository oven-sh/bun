"use strict";
function show(label, make) { let text; try { text = String(make()); } catch (error) { text = error.constructor.name + ": " + error.message; } console.log(label + ": " + text); }
function V(x) { this.x = x; }
function W(y) { this.y = y; }
function sum(make, n) { let total = 0; for (let i = 0; i < n; i++) total += make(i); return total; }
function make(step) { return { get() { return this.x + step; } }; }
Object.assign(V.prototype, make(1));
Object.assign(W.prototype, make(2));
W.prototype.x = 10;
show("one", () => new V(3).get());
show("loop", () => sum(i => new V(i & 7).get(), 2000));
show("own", () => Object.keys(V.prototype).join() + " | " + Object.getOwnPropertyNames(V.prototype).join());
show("descriptor", () => JSON.stringify(Object.getOwnPropertyDescriptor(V.prototype, "get"), (key, value) => typeof value === "function" ? "function " + value.name : value));
show("w", () => sum(i => new W(i).get(), 2000));
