(function (definition) {
  if (typeof module === "object" && typeof module.exports === "object") module.exports = definition();
  else { var exports = definition(); globalThis.lib = exports; console.log("else"); }
})(function () {
  function Node(x) { this.x = x; }
  var lib = { clean: function (n) { n.f = 0; n.parent = null; }, sum: function (list) { var s = 0; for (var i = 0; i < list.length; i++) { var n = list[i]; n.f = n.f + 1; s = s + n.x + n.f; } return s; } };
  return { Node: Node, lib: lib };
});
const { Node, lib } = module.exports;
var nodes = []; for (var i = 0; i < 40; i++) nodes.push(new Node(i));
nodes.forEach(lib.clean);
console.log(lib.sum(nodes), lib.sum(nodes), typeof module.exports, typeof globalThis.lib);

function wrapped() {
  let box = { exports: {} };
  (function (root, factory) {
    if (typeof box === "object" && typeof box.exports === "object") box.exports = factory();
    else { root.boxed = factory(); console.log("else"); }
  })(globalThis, function () { return function () { return typeof box.exports; }; });
  return box.exports() + " " + typeof box + " " + typeof box.exports;
}
console.log(wrapped(), wrapped());

const key = "p", tell = f => f(), log = [];
function run(name, f) { try { log.push(name + " " + f(0)); } catch (e) { log.push(name + " " + e.constructor.name); } }
run("stored", () => { let o = { p: {} }; o.p = 0; return typeof o.p; });
run("by a call", () => { let o = { p: {} }; change(); return typeof o.p + (o.p ? 1 : 2); function change() { o.p = 0; } });
run("handed out", () => { let o = { p: {} }; (v => { v.p = 0; })(o); return typeof o.p; });
run("under a key", () => { let o = { p: {} }; o[key] = ""; return typeof o.p; });
run("in a loop", () => { let o = { p: {} }, s = ""; for (let i = 0; i < 3; i++) { s += typeof o.p; o.p = i; } return s; });
run("by an argument", () => { let o = { p: {} }, s; (function () { s = typeof o.p; })(o.p = 0); return s; });
run("by itself", () => { let o = { p: {} }, s = ""; (function again(n) { s += typeof o.p; o.p = n; if (n) again(n - 1); })(2); return s; });
run("later", () => { let o = { p: {} }, s = ""; const h = () => { s += o.p ? "t" : "f"; o.p = 0; }; h(); h(); return s; });
run("deleted", () => { let o = { p: {} }; delete o.p; return typeof o.p; });
run("by a pattern", () => { let o = { p: {} }; [o.p] = [0]; return o.p ? 1 : 2; });
run("by for-of", () => { let o = { p: {} }; for (o.p of ["", 0]); return typeof o.p; });
run("in a case", n => { let o = { p: {} }; switch (n) { default: return typeof o.p; case (o.p = 1): } });
run("by a getter", () => { let o = { get p() { return 0; } }; return typeof o.p; });
run("under a setter above", () => { let o = { p: {} }; Object.setPrototypeOf(o, { set q(v) { this.p = v; } }); o.q = 5; return typeof o.p; });
run("before", () => { var s = typeof o; var o = { p: {} }; return s + typeof o.p; });
run("dead zone", () => { tell(() => typeof o.p); let o = { p: {} }; return typeof o.p; });
console.log(log.join("\n"));
