"use strict";
function put(o, v) { o.fixed = v; return Object.hasOwn(o, "fixed"); }
const seen = [];
for (let i = 0; i < 4; i++) seen.push(put(Object.create(exports), i));
Object.defineProperty(exports, "fixed", { value: "fixed" });
for (let i = 0; i < 4; i++) { try { seen.push(put(Object.create(exports), i)); } catch (e) { seen.push(e.constructor.name); } }
exports.seen = seen.join();
