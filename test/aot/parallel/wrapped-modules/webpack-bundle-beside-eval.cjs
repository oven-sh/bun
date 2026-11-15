// A function with a direct eval stands beside the bundle.
(() => { "use strict";
var mods = {
"./a.js": (m, exports, req) => { exports.f = (x) => "f" + x; exports.K = class { constructor(x) { this.x = x; } }; },
"./b.js": (m, exports, req) => { var a = req("./a.js"); exports.g = (x) => a.f(x) + "g"; exports.late = () => req("./c.js").h(1);  },
"./c.js": (m, exports, req) => { var b = req("./b.js"); exports.h = (x) => "h" + x + typeof b.g; },
"./main.js": (m, exports, req) => { var u = req("./b.js"), a = req("./a.js"); exports.go = (n) => [u.g(n), u.late(), new a.K(n).x].join(); } };
var cache = {}; function req(id) { var c = cache[id]; if (c !== undefined) return c.exports; var m = cache[id] = { exports: {} }; mods[id](m, m.exports, req); return m.exports; }
console.log(req("./main.js").go(3));
})();
function evaluate(s) { return eval(s); }
console.log(evaluate("1 + 1"));
