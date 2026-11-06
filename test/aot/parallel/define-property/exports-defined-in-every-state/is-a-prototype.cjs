"use strict";
const child = Object.create(exports);
const seen = [];
const read = o => o.fixed;
for (let i = 0; i < 5; i++) seen.push(read(child));
child.early = 1;
Object.defineProperty(exports, "fixed", { value: "fixed" });
Object.defineProperty(exports, "getter", { get() { return "got by " + (this === child ? "child" : "exports"); } });
for (let i = 0; i < 5; i++) seen.push(read(child));
try { child.fixed = 2; seen.push("stored"); } catch (e) { seen.push(e.constructor.name); }
try { child.getter = 2; seen.push("stored"); } catch (e) { seen.push(e.constructor.name); }
seen.push(child.getter, Object.keys(child).join());
exports.seen = seen.join();
