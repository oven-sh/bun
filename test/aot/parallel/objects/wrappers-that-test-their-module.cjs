(function (bake) {
  var exports = bake();
  if (typeof module !== "object") { globalThis.bakery = exports; console.log("no module"); }
  else if (typeof module.exports === "object") module.exports = exports;
})(function () {
  function Loaf(weight) { this.weight = weight; }
  var bakery = { weigh: function (loaves) { var all = 0; for (var i = 0; i < loaves.length; i++) { var loaf = loaves[i]; loaf.turns += 1; all = all + loaf.turns + loaf.weight; } return all; }, dust: function (loaf) { loaf.tin = null; loaf.turns = 0; } };
  return { bakery: bakery, Loaf: Loaf };
});
const { bakery, Loaf } = module.exports;
var loaves = []; for (var i = 0; i < 40; i++) loaves.push(new Loaf(i));
loaves.forEach(bakery.dust);
console.log(bakery.weigh(loaves), bakery.weigh(loaves), typeof module.exports, typeof globalThis.bakery);

function wrapped() {
  let box = { exports: {} };
  (function (place, bake) {
    if (typeof box !== "object" || typeof box.exports !== "object") { place.baked = bake(); console.log("no box"); }
    else box.exports = bake();
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
