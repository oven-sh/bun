// CommonJS modules whose `var m = require(..)` is read by a getter or a callback before the `require` has run.
function said(f) { try { const v = f(); return typeof v === "function" ? "F" : String(v); } catch (e) { return "threw " + e.name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
function show(v) { return typeof v === "function" ? "F" : String(v); }
try { console.log("e1: " + require("./files/e1").got); } catch (e) { console.log("e1: threw " + e.name); }
try { console.log("e2: " + require("./files/e2").got); } catch (e) { console.log("e2: threw " + e.name); }
try { console.log("e3: " + require("./files/e3").got); } catch (e) { console.log("e3: threw " + e.name); }
try { console.log("e4: " + require("./files/e4").got); } catch (e) { console.log("e4: threw " + e.name); }
try { console.log("e5: " + require("./files/e5").got); } catch (e) { console.log("e5: threw " + e.name); }
try { console.log("e6: " + require("./files/e6").got); } catch (e) { console.log("e6: threw " + e.name); }
try { console.log("e7: " + require("./files/e7").got); } catch (e) { console.log("e7: threw " + e.name); }
