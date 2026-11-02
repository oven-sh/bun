"use strict";
function show(label, make) { let text; try { text = String(make()); } catch (error) { text = error.constructor.name + ": " + error.message; } console.log(label + ": " + text); }
function V(x) { this.x = x; }
function W(y) { this.y = y; }
function sum(make, n) { let total = 0; for (let i = 0; i < n; i++) total += make(i); return total; }
Object.assign(V.prototype, { get() { return this.x + 1; } });
show("one", () => new V(3).get());
show("loop", () => sum(i => new V(i & 7).get(), 2000));
show("own", () => Object.keys(V.prototype).join() + " | " + Object.getOwnPropertyNames(V.prototype).join());
show("descriptor", () => JSON.stringify(Object.getOwnPropertyDescriptor(V.prototype, "get"), (key, value) => typeof value === "function" ? "function " + value.name : value));
show("hidden", () => sum(i => { const v = new V(i & 7); if (i & 1) v.get = () => 1000; return v.get(); }, 2000));
