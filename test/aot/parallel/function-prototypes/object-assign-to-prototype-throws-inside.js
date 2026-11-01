"use strict";
function show(label, make) { let text; try { text = String(make()); } catch (error) { text = error.constructor.name + ": " + error.message; } console.log(label + ": " + text); }
function V(x) { this.x = x; }
function W(y) { this.y = y; }
function sum(make, n) { let total = 0; for (let i = 0; i < n; i++) total += make(i); return total; }
Object.assign(V.prototype, { get() { if (this.x > 5) throw new RangeError("over " + this.x); return this.x; } });
show("one", () => new V(3).get());
show("loop", () => sum(i => new V(i & 7).get(), 2000));
show("own", () => Object.keys(V.prototype).join() + " | " + Object.getOwnPropertyNames(V.prototype).join());
show("descriptor", () => JSON.stringify(Object.getOwnPropertyDescriptor(V.prototype, "get"), (key, value) => typeof value === "function" ? "function " + value.name : value));
show("stack", () => { try { new V(9).get(); } catch (error) { return error.stack.split("\n").slice(0, 3).map(line => line.trim().replace(/\(.*[\\/]/, "(")).join(" < "); } });
