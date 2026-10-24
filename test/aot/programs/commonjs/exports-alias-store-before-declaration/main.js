// CommonJS modules that store to a property of `var u = exports` (or of a required module) before that declaration has run.
function said(f) { try { const v = f(); return typeof v === "function" ? "F" : String(v); } catch (e) { return "threw " + e.name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
function show(v) { return typeof v === "function" ? "F" : String(v); }
try { console.log("i1: " + show(require("./files/i1").log)); } catch (e) { console.log("i1: threw " + e.name); }
try { console.log("i2: " + show(require("./files/i2").log)); } catch (e) { console.log("i2: threw " + e.name); }
try { console.log("i3: " + show(require("./files/i3").log)); } catch (e) { console.log("i3: threw " + e.name); }
try { console.log("i4: " + show(require("./files/i4").log)); } catch (e) { console.log("i4: threw " + e.name); }
try { console.log("i5: " + show(require("./files/i5").log)); } catch (e) { console.log("i5: threw " + e.name); }
