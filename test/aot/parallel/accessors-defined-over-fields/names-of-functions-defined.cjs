// A definition of a function's name that nothing has read yet.
"use strict";
const attempt = f => { try { return String(f()); } catch (e) { return e.name; } };
const show = f => Reflect.ownKeys(f).filter(k => k !== "prototype" && k !== "arguments" && k !== "caller").map(k => { const d = Object.getOwnPropertyDescriptor(f, k); return String(k) + (d.enumerable ? "e" : "") + (d.configurable ? "c" : "") + (d.writable ? "w" : "") + (d.get ? "g" : "=" + String(d.value)); }).join(" ");
const captured = {};
function make(n, o) {
  switch (n) {
  case 0: return function written() { return o; };
  case 1: return () => o;
  case 2: return { method() { return o; } }.method;
  case 3: return Object.getOwnPropertyDescriptor({ get got() { return o; } }, "got").get;
  case 4: return class Named { own() { return o; } };
  case 5: return class { static other = 1; };
  case 6: return function () { return o; }.bind(null);
  case 7: return async () => o;
  case 8: return function* steps() { yield o; };
  case 9: return class { static name = "fixed"; };
  case 10: { const f = function () { return o; }; f.isAction = true; return f; }
  case 11: { const f = function f() { return o; }; f.isAction = true; return f; }
  default: return new Proxy(function through() { return o; }, {});
  }
}
const descriptors = [{ value: "given" }, { value: "given", configurable: true }, { value: "given", configurable: true, writable: false, enumerable: false }, { value: "given", writable: true }, { value: "given", enumerable: true }, { value: "given", configurable: false },
  { value: "written" }, { value: "f", configurable: true }, { value: "" }, { value: 5 }, { value: undefined }, { value: ["gi", "ven"].join("") + String.fromCharCode(97) }, { get: () => "got" }, { writable: true }, {}, { value: "given", configurable: true, writable: true, enumerable: true }];
for (let n = 0; n < 13; n++) {
  for (let d = 0; d < descriptors.length; d++) {
    const row = [];
    for (let before = 0; before < 6; before++) {
      const f = make(n, captured);
      if (before === 1) row.push(f.name);
      if (before === 2) Object.freeze(f);
      if (before === 3) Object.preventExtensions(f);
      if (before === 4) row.push(attempt(() => delete f.name));
      if (before === 5) f.beside = 1;
      row.push(attempt(() => (Object.defineProperty(f, "name", descriptors[d]), "ok")), attempt(() => f.name), show(f), attempt(() => { f.name = "stored"; return f.name; }), attempt(() => (Object.defineProperty(f, "name", { value: "again" }), f.name)), attempt(() => f.bind(null).name), attempt(() => delete f.name), attempt(() => f.name), "name" in f);
    }
    console.log(n, d, row.join(" | "));
  }
}
const shared = { value: "", configurable: true, writable: false, enumerable: false };
function action(name, fn) { function run() { return fn.apply(this, arguments); } run.isAction = true; shared.value = name; Object.defineProperty(run, "name", shared); return run; }
let text = "";
for (let n = 0; n < 60; n++) { const f = action("action" + n % 7, x => x + n); text += f.name + f(1) + f.isAction + show(f) + ";"; }
console.log(text);
