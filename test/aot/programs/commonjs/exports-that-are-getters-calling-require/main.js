// CommonJS modules whose exports are getters that call `require` themselves.
function said(f) { try { const v = f(); return typeof v === "function" ? "F" : String(v); } catch (e) { return "threw " + e.name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
function show(v) { return typeof v === "function" ? "F" : String(v); }
try { console.log("a getter that requires: " + show(require("./files/b1").a)); } catch (e) { console.log("a getter that requires: threw " + e.name); }
try { console.log("a getter over a holder that never ran: " + show(require("./files/b2").a)); } catch (e) { console.log("a getter over a holder that never ran: threw " + e.name); }
try { require("./files/b2o");  console.log("the same, the other module evaluated: " + show(require("./files/b2").a)); } catch (e) { console.log("the same, the other module evaluated: threw " + e.name); }
try { console.log("control: a getter over a holder: " + show(require("./files/b3").a)); } catch (e) { console.log("control: a getter over a holder: threw " + e.name); }
try { console.log("a getter over a holder in a try: " + show(require("./files/b4").a)); } catch (e) { console.log("a getter over a holder in a try: threw " + e.name); }
try { console.log("a getter over a holder declared behind it: " + show(require("./files/b5").a)); } catch (e) { console.log("a getter over a holder declared behind it: threw " + e.name); }
try { console.log("a getter over a let in a block: " + show(require("./files/b6").a)); } catch (e) { console.log("a getter over a let in a block: threw " + e.name); }
try { console.log("a store above the star that does not run: " + show(require("./files/b7").x)); } catch (e) { console.log("a store above the star that does not run: threw " + e.name); }
try { console.log("a store above the star in a function: " + show(require("./files/b8").x)); } catch (e) { console.log("a store above the star in a function: threw " + e.name); }
try { console.log("control: the store above the star runs: " + show(require("./files/b9").x)); } catch (e) { console.log("control: the store above the star runs: threw " + e.name); }
try { console.log("control: a dead store below the star: " + show(require("./files/b10").x)); } catch (e) { console.log("control: a dead store below the star: threw " + e.name); }
try { require("./files/b11_bo");  console.log("a read above the star: " + show(require("./files/b11").early)); } catch (e) { console.log("a read above the star: threw " + e.name); }
try { console.log("a read below the star: " + show(require("./files/b12").late)); } catch (e) { console.log("a read below the star: threw " + e.name); }
try { require("./files/b13_bo");  console.log("a call above the star: " + show(require("./files/b13").early)); } catch (e) { console.log("a call above the star: threw " + e.name); }
try { console.log("an arrow as the getter, which requires: " + show(require("./files/b14").a)); } catch (e) { console.log("an arrow as the getter, which requires: threw " + e.name); }
