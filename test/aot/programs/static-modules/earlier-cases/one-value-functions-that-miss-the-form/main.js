// Modules that are one function, stored twice, perhaps, late, as null, or held by a variable that is stored again.
const show = (f) => { try { return String(f()); } catch (e) { return e.constructor.name; } };
const twice = require("./twice"), maybe = require("./maybe"), late = require("./late"), nil = require("./nil"), reassigned = require("./reassigned");
function viaFunction() { const lazy = require("./lazy"); return lazy(); }
late.swap();
console.log(show(twice), show(maybe), show(late), show(require("./late")), show(nil), show(reassigned), viaFunction());
const { a } = require("./pattern"), { a: renamed, missing } = require("./pattern");
function often(n) { let s = ""; for (let i = 0; i < n; i++) s = a() + renamed(); return s; }
console.log(often(3), typeof missing);
