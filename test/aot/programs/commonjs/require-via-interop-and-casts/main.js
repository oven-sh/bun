// `require` of CommonJS modules through interop helpers and casts, with compound assignments to their exports.
function said(f) { try { const v = f(); return typeof v === "function" ? "F" : String(v); } catch (e) { return "threw " + e.name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
function show(v) { return typeof v === "function" ? "F" : String(v); }
function _interop(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
try { const m = require("./files/a1");  console.log("a cast: " + show(m.f() + " " + m.own)); } catch (e) { console.log("a cast: threw " + e.name); }
try { console.log("compound and increment through a cast: " + show(require("./files/a2").n)); } catch (e) { console.log("compound and increment through a cast: threw " + e.name); }
try { console.log("an array pattern through a cast: " + show(require("./files/a3").f())); } catch (e) { console.log("an array pattern through a cast: threw " + e.name); }
try { console.log("an object pattern through a cast: " + show(require("./files/a4").f())); } catch (e) { console.log("an object pattern through a cast: threw " + e.name); }
try { console.log("a function that reads this: " + show(typeof require("./files/a5").f())); } catch (e) { console.log("a function that reads this: threw " + e.name); }
try { const m = require("./files/a6"); /** @type {any} */ (m.f) = () => "second";  console.log("the importer's store: " + show(m.f() + " " + m.call())); } catch (e) { console.log("the importer's store: threw " + e.name); }
try { console.log("the marker: " + show(_interop(require("./files/a7")).default.length)); } catch (e) { console.log("the marker: threw " + e.name); }
try { console.log("a star's key: " + show(require("./files/a8").y)); } catch (e) { console.log("a star's key: threw " + e.name); }
try { console.log("the default of an array pattern's element: " + show(require("./files/a9").f())); } catch (e) { console.log("the default of an array pattern's element: threw " + e.name); }
try { console.log("the default of an object pattern's element: " + show(require("./files/a10").f())); } catch (e) { console.log("the default of an object pattern's element: threw " + e.name); }
try { console.log("control: the default is used: " + show(require("./files/a11").f())); } catch (e) { console.log("control: the default is used: threw " + e.name); }
try { console.log("the head of a for-of: " + show(require("./files/a12").f())); } catch (e) { console.log("the head of a for-of: threw " + e.name); }
try { const m = require("./files/a13");  console.log("delete through a cast: " + show(m.d + " " + m.has)); } catch (e) { console.log("delete through a cast: threw " + e.name); }
try { console.log("two casts: " + show(require("./files/a14").f())); } catch (e) { console.log("two casts: threw " + e.name); }
try { console.log("a logical assignment through a cast: " + show(require("./files/a15").g())); } catch (e) { console.log("a logical assignment through a cast: threw " + e.name); }
try { console.log("control: parentheses alone: " + show(require("./files/a16").f())); } catch (e) { console.log("control: parentheses alone: threw " + e.name); }
try { console.log("the default, a function that reads this: " + show(typeof require("./files/a17").f())); } catch (e) { console.log("the default, a function that reads this: threw " + e.name); }
try { const f = require("./files/a9").f;  console.log("the default, read out and called: " + show(f())); } catch (e) { console.log("the default, read out and called: threw " + e.name); }
try { console.log("a cast on module.exports.name: " + show(require("./files/a18").f())); } catch (e) { console.log("a cast on module.exports.name: threw " + e.name); }
try { console.log("a cast on this.name: " + show(require("./files/a19").f())); } catch (e) { console.log("a cast on this.name: threw " + e.name); }
