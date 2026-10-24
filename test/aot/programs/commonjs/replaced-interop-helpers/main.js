// CommonJS modules whose interop helper (`_interop`, `__importDefault`) is replaced before it is used.
function said(f) { try { const v = f(); return typeof v === "function" ? "F" : String(v); } catch (e) { return "threw " + e.name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
function show(v) { return typeof v === "function" ? "F" : String(v); }
try { console.log("g1: " + show(require("./files/g1").got)); } catch (e) { console.log("g1: threw " + e.name); }
try { console.log("g2: " + show(require("./files/g2").got)); } catch (e) { console.log("g2: threw " + e.name); }
try { console.log("g3: " + show(require("./files/g3").got)); } catch (e) { console.log("g3: threw " + e.name); }
try { console.log("g4: " + show(require("./files/g4").got)); } catch (e) { console.log("g4: threw " + e.name); }
try { console.log("g5: " + show(require("./files/g5").got)); } catch (e) { console.log("g5: threw " + e.name); }
try { console.log("g6: " + show(require("./files/g6").got)); } catch (e) { console.log("g6: threw " + e.name); }
