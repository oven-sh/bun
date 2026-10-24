// CommonJS modules that shadow `exports`, `module` or `require` with their own declarations.
function said(f) { try { const v = f(); return typeof v === "function" ? "F" : String(v); } catch (e) { return "threw " + e.name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
function show(v) { return typeof v === "function" ? "F" : String(v); }
try { console.log("a pattern binds exports: " + require("./files/f7").got); } catch (e) { console.log("a pattern binds exports: threw " + e.name); }
try { console.log("a const named module: " + require("./files/f8").got); } catch (e) { console.log("a const named module: threw " + e.name); }
try { console.log("a const named module, in a block: " + require("./files/f9").got); } catch (e) { console.log("a const named module, in a block: threw " + e.name); }
try { console.log("control: a parameter named module: " + require("./files/f10").got); } catch (e) { console.log("control: a parameter named module: threw " + e.name); }
try { console.log("a let named exports: " + require("./files/f11").got); } catch (e) { console.log("a let named exports: threw " + e.name); }
try { console.log("var exports = exports || {}: " + require("./files/f1").a); } catch (e) { console.log("var exports = exports || {}: threw " + e.name); }
try { console.log("if (typeof exports is undefined) var exports: " + require("./files/f2").a); } catch (e) { console.log("if (typeof exports is undefined) var exports: threw " + e.name); }
try { console.log("var exports;: " + require("./files/f3").a); } catch (e) { console.log("var exports;: threw " + e.name); }
try { console.log("var module = module || ..: " + require("./files/f4").a); } catch (e) { console.log("var module = module || ..: threw " + e.name); }
try { console.log("control: var exports = module.exports: " + require("./files/f5").a); } catch (e) { console.log("control: var exports = module.exports: threw " + e.name); }
try { console.log("var exports = {}: " + require("./files/f6").a + " " + require("./files/f6").b); } catch (e) { console.log("var exports = {}: threw " + e.name); }
try { console.log("var exports in a function: " + require("./files/f12").a); } catch (e) { console.log("var exports in a function: threw " + e.name); }
