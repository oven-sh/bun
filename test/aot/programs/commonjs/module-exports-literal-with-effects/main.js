// CommonJS modules that assign an object literal to `module.exports`, where the literal calls functions or throws half-way.
function said(f) { try { const v = f(); return typeof v === "function" ? "F" : String(v); } catch (e) { return "threw " + e.name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
function show(v) { return typeof v === "function" ? "F" : String(v); }
try { console.log("a function called from inside the literal: " + show(require("./files/c1").b)); } catch (e) { console.log("a function called from inside the literal: threw " + e.name); }
try { try { require("./files/c2"); } catch {}  console.log("a literal that throws half-way: " + show(globalThis.c2())); } catch (e) { console.log("a literal that throws half-way: threw " + e.name); }
try { const m = require("./files/c3");  console.log("control: a literal: " + show(m.a + " " + m.b)); } catch (e) { console.log("control: a literal: threw " + e.name); }
try { console.log("a name twice: " + show(require("./files/c4").a)); } catch (e) { console.log("a name twice: threw " + e.name); }
try { console.log("the order of the values: " + show(require("./files/c5").log)); } catch (e) { console.log("the order of the values: threw " + e.name); }
try { console.log("a method of the literal called later: " + show(require("./files/c6").f())); } catch (e) { console.log("a method of the literal called later: threw " + e.name); }
