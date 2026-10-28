"use strict";
// Another file freezes the exports.
const m = require("./m.cjs");
Object.freeze(m);
try { m.a = 2; console.log("stored"); } catch (e) { console.log(e.name); }
try { m.set(3); console.log("stored inside"); } catch (e) { console.log(e.name); }
console.log(m.a, m.readA(), Object.isFrozen(m));
