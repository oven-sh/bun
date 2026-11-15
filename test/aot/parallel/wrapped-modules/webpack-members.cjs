// What is read off webpack's require function: members that the runtime stores on it, members of every function, members that yield the function itself.
var out = [], attempt = f => { try { var v = f(); return typeof v === "function" ? "function" : typeof v === "object" && v ? Object.keys(v).join() : String(v); } catch (error) { return error.constructor.name; } };
(() => {
  var modules = { 5: (module, exports) => { out.push("5 runs"); exports.a = 1; }, 6: (module, exports, require) => { exports.b = require(5).a + 1; } }, cache = {};
  function load(id) { var cached = cache[id]; if (cached !== undefined) return cached.exports; var module = (cache[id] = { exports: {} }); modules[id](module, module.exports, load); return module.exports; }
  out.push(load(6).b, attempt(() => load.call(null, 5).a), attempt(() => load.apply(null, [5]).a), attempt(() => load.bind(null, 5)().a), load.name, load.length, attempt(() => load.toString().slice(0, 8)));
  Promise.resolve().then(load.bind(null, 6)).then(it => out.push("then " + it.b), error => out.push("rejected " + error.constructor.name));
})();
module.exports = out;
setTimeout(() => console.log(out.join("\n")), 1);
