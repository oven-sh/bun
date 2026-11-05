// esbuild's __commonJS runs the first own name of the literal it is given. `{ __proto__: f }` sets the prototype and has no own name; a method, a computed key and a
// shorthand of that name are members.
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() { return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports; };
var require_a = __commonJS({ __proto__: function (exports) { exports.x = 1; } });
var require_b = __commonJS({ "__proto__": function (exports) { exports.x = 2; } });
var require_c = __commonJS({ __proto__(exports) { exports.x = 3; } });
var require_d = __commonJS({ ["__proto__"]: function (exports) { exports.x = 4; } });
var __proto__ = function (exports) { exports.x = 5; };
var require_e = __commonJS({ __proto__ });
var require_f = __commonJS({ "src/f.js"(exports) { exports.x = 6; } });
try { console.log("a name and a colon", JSON.stringify(require_a())); } catch (error) { console.log("a name and a colon threw", error.name); }
try { console.log("a text and a colon", JSON.stringify(require_b())); } catch (error) { console.log("a text and a colon threw", error.name); }
try { console.log("a method", JSON.stringify(require_c())); } catch (error) { console.log("a method threw", error.name); }
try { console.log("a computed key", JSON.stringify(require_d())); } catch (error) { console.log("a computed key threw", error.name); }
try { console.log("a shorthand", JSON.stringify(require_e())); } catch (error) { console.log("a shorthand threw", error.name); }
try { console.log("as esbuild writes it", JSON.stringify(require_f())); } catch (error) { console.log("as esbuild writes it threw", error.name); }
