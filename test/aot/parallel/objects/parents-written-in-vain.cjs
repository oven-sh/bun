// A function that inherits through a surrogate, and another write of the parent that throws, gives false, does not run or succeeds.
const log = [];
const say = (f) => { try { log.push(String(f())); } catch (e) { log.push(e.constructor.name + (e.message.includes("compiled") ? " " + e.message.slice(0, 30) : "")); } };
(function () {
  function inherit(heir, base) { function Link() {} Link.prototype = base.prototype; heir.prototype = new Link(); heir.prototype.constructor = heir; }
  function B(n) { this.n = n; } function H(n) { B.call(this, n); } function G(n) { H.call(this, n); } function S(n) { H.call(this, n); }
  function X() {} X.prototype.m = function () { return 100; }; X.prototype.v = 300; function Y() {}
  inherit(H, B); inherit(G, H); inherit(S, H);
  B.prototype.m = function () { return 1 + (this.n | 0); }; B.prototype.v = 3;
  function sum(list) { let total = 0; for (let i = 0; i < list.length; i++) total += list[i].m() * 2 + list[i].v; return total; }
  const list = [new G(1), new G(2)];
  log.push("ring by Object.setPrototypeOf"); say(() => { Object.setPrototypeOf(H.prototype, G.prototype); });
  for (let k = 0; k < 2; k++) { say(() => sum(list)); say(() => new H(3).m()); say(() => new S(4).m() + new S(5).v); }
})();
(function () {
  function inherit(heir, base) { function Link() {} Link.prototype = base.prototype; heir.prototype = new Link(); heir.prototype.constructor = heir; }
  function B(n) { this.n = n; } function H(n) { B.call(this, n); } function G(n) { H.call(this, n); } function S(n) { H.call(this, n); }
  function X() {} X.prototype.m = function () { return 100; }; X.prototype.v = 300; function Y() {}
  inherit(H, B); inherit(G, H); inherit(S, H);
  B.prototype.m = function () { return 1 + (this.n | 0); }; B.prototype.v = 3;
  function sum(list) { let total = 0; for (let i = 0; i < list.length; i++) total += list[i].m() * 2 + list[i].v; return total; }
  const list = [new G(1), new G(2)];
  log.push("ring by Reflect"); say(() => { return Reflect.setPrototypeOf(H.prototype, G.prototype); });
  for (let k = 0; k < 2; k++) { say(() => sum(list)); say(() => new H(3).m()); say(() => new S(4).m() + new S(5).v); }
})();
(function () {
  function inherit(heir, base) { function Link() {} Link.prototype = base.prototype; heir.prototype = new Link(); heir.prototype.constructor = heir; }
  function B(n) { this.n = n; } function H(n) { B.call(this, n); } function G(n) { H.call(this, n); } function S(n) { H.call(this, n); }
  function X() {} X.prototype.m = function () { return 100; }; X.prototype.v = 300; function Y() {}
  inherit(H, B); inherit(G, H); inherit(S, H);
  B.prototype.m = function () { return 1 + (this.n | 0); }; B.prototype.v = 3;
  function sum(list) { let total = 0; for (let i = 0; i < list.length; i++) total += list[i].m() * 2 + list[i].v; return total; }
  const list = [new G(1), new G(2)];
  log.push("ring by __proto__"); say(() => { H.prototype.__proto__ = G.prototype; });
  for (let k = 0; k < 2; k++) { say(() => sum(list)); say(() => new H(3).m()); say(() => new S(4).m() + new S(5).v); }
})();
(function () {
  function inherit(heir, base) { function Link() {} Link.prototype = base.prototype; heir.prototype = new Link(); heir.prototype.constructor = heir; }
  function B(n) { this.n = n; } function H(n) { B.call(this, n); } function G(n) { H.call(this, n); } function S(n) { H.call(this, n); }
  function X() {} X.prototype.m = function () { return 100; }; X.prototype.v = 300; function Y() {}
  inherit(H, B); inherit(G, H); inherit(S, H);
  B.prototype.m = function () { return 1 + (this.n | 0); }; B.prototype.v = 3;
  function sum(list) { let total = 0; for (let i = 0; i < list.length; i++) total += list[i].m() * 2 + list[i].v; return total; }
  const list = [new G(1), new G(2)];
  log.push("not extensible"); say(() => { Object.preventExtensions(H.prototype); Object.setPrototypeOf(H.prototype, X.prototype); });
  for (let k = 0; k < 2; k++) { say(() => sum(list)); say(() => new H(3).m()); say(() => new S(4).m() + new S(5).v); }
})();
(function () {
  function inherit(heir, base) { function Link() {} Link.prototype = base.prototype; heir.prototype = new Link(); heir.prototype.constructor = heir; }
  function B(n) { this.n = n; } function H(n) { B.call(this, n); } function G(n) { H.call(this, n); } function S(n) { H.call(this, n); }
  function X() {} X.prototype.m = function () { return 100; }; X.prototype.v = 300; function Y() {}
  inherit(H, B); inherit(G, H); inherit(S, H);
  B.prototype.m = function () { return 1 + (this.n | 0); }; B.prototype.v = 3;
  function sum(list) { let total = 0; for (let i = 0; i < list.length; i++) total += list[i].m() * 2 + list[i].v; return total; }
  const list = [new G(1), new G(2)];
  log.push("not extensible by Reflect"); say(() => { Object.freeze(H.prototype); return Reflect.setPrototypeOf(H.prototype, Y.prototype); });
  for (let k = 0; k < 2; k++) { say(() => sum(list)); say(() => new H(3).m()); say(() => new S(4).m() + new S(5).v); }
})();
(function () {
  function inherit(heir, base) { function Link() {} Link.prototype = base.prototype; heir.prototype = new Link(); heir.prototype.constructor = heir; }
  function B(n) { this.n = n; } function H(n) { B.call(this, n); } function G(n) { H.call(this, n); } function S(n) { H.call(this, n); }
  function X() {} X.prototype.m = function () { return 100; }; X.prototype.v = 300; function Y() {}
  inherit(H, B); inherit(G, H); inherit(S, H);
  B.prototype.m = function () { return 1 + (this.n | 0); }; B.prototype.v = 3;
  function sum(list) { let total = 0; for (let i = 0; i < list.length; i++) total += list[i].m() * 2 + list[i].v; return total; }
  const list = [new G(1), new G(2)];
  log.push("refused by a proxy"); say(() => { Object.setPrototypeOf(new Proxy(H.prototype, { setPrototypeOf() { return false; } }), X.prototype); });
  for (let k = 0; k < 2; k++) { say(() => sum(list)); say(() => new H(3).m()); say(() => new S(4).m() + new S(5).v); }
})();
(function () {
  function inherit(heir, base) { function Link() {} Link.prototype = base.prototype; heir.prototype = new Link(); heir.prototype.constructor = heir; }
  function B(n) { this.n = n; } function H(n) { B.call(this, n); } function G(n) { H.call(this, n); } function S(n) { H.call(this, n); }
  function X() {} X.prototype.m = function () { return 100; }; X.prototype.v = 300; function Y() {}
  inherit(H, B); inherit(G, H); inherit(S, H);
  B.prototype.m = function () { return 1 + (this.n | 0); }; B.prototype.v = 3;
  function sum(list) { let total = 0; for (let i = 0; i < list.length; i++) total += list[i].m() * 2 + list[i].v; return total; }
  const list = [new G(1), new G(2)];
  log.push("refused by a proxy, behind a write that does not run"); say(() => { if (process.argv.length > 99) Object.setPrototypeOf(H.prototype, Y.prototype); return Reflect.setPrototypeOf(new Proxy(H.prototype, { setPrototypeOf() { return false; } }), X.prototype); });
  for (let k = 0; k < 2; k++) { say(() => sum(list)); say(() => new H(3).m()); say(() => new S(4).m() + new S(5).v); }
})();
(function () {
  function inherit(heir, base) { function Link() {} Link.prototype = base.prototype; heir.prototype = new Link(); heir.prototype.constructor = heir; }
  function B(n) { this.n = n; } function H(n) { B.call(this, n); } function G(n) { H.call(this, n); } function S(n) { H.call(this, n); }
  function X() {} X.prototype.m = function () { return 100; }; X.prototype.v = 300; function Y() {}
  inherit(H, B); inherit(G, H); inherit(S, H);
  B.prototype.m = function () { return 1 + (this.n | 0); }; B.prototype.v = 3;
  function sum(list) { let total = 0; for (let i = 0; i < list.length; i++) total += list[i].m() * 2 + list[i].v; return total; }
  const list = [new G(1), new G(2)];
  log.push("immutable"); say(() => { if (process.argv.length > 99) Object.setPrototypeOf(H.prototype, X.prototype); Object.setPrototypeOf(Object.prototype, {}); });
  for (let k = 0; k < 2; k++) { say(() => sum(list)); say(() => new H(3).m()); say(() => new S(4).m() + new S(5).v); }
})();
(function () {
  function inherit(heir, base) { function Link() {} Link.prototype = base.prototype; heir.prototype = new Link(); heir.prototype.constructor = heir; }
  function B(n) { this.n = n; } function H(n) { B.call(this, n); } function G(n) { H.call(this, n); } function S(n) { H.call(this, n); }
  function X() {} X.prototype.m = function () { return 100; }; X.prototype.v = 300; function Y() {}
  inherit(H, B); inherit(G, H); inherit(S, H);
  B.prototype.m = function () { return 1 + (this.n | 0); }; B.prototype.v = 3;
  function sum(list) { let total = 0; for (let i = 0; i < list.length; i++) total += list[i].m() * 2 + list[i].v; return total; }
  const list = [new G(1), new G(2)];
  log.push("not an object"); say(() => { Object.setPrototypeOf(H.prototype, 5); });
  for (let k = 0; k < 2; k++) { say(() => sum(list)); say(() => new H(3).m()); say(() => new S(4).m() + new S(5).v); }
})();
(function () {
  function inherit(heir, base) { function Link() {} Link.prototype = base.prototype; heir.prototype = new Link(); heir.prototype.constructor = heir; }
  function B(n) { this.n = n; } function H(n) { B.call(this, n); } function G(n) { H.call(this, n); } function S(n) { H.call(this, n); }
  function X() {} X.prototype.m = function () { return 100; }; X.prototype.v = 300; function Y() {}
  inherit(H, B); inherit(G, H); inherit(S, H);
  B.prototype.m = function () { return 1 + (this.n | 0); }; B.prototype.v = 3;
  function sum(list) { let total = 0; for (let i = 0; i < list.length; i++) total += list[i].m() * 2 + list[i].v; return total; }
  const list = [new G(1), new G(2)];
  log.push("thrown before"); say(() => { (() => { throw new RangeError("first"); })(); Object.setPrototypeOf(H.prototype, X.prototype); });
  for (let k = 0; k < 2; k++) { say(() => sum(list)); say(() => new H(3).m()); say(() => new S(4).m() + new S(5).v); }
})();
(function () {
  function inherit(heir, base) { function Link() {} Link.prototype = base.prototype; heir.prototype = new Link(); heir.prototype.constructor = heir; }
  function B(n) { this.n = n; } function H(n) { B.call(this, n); } function G(n) { H.call(this, n); } function S(n) { H.call(this, n); }
  function X() {} X.prototype.m = function () { return 100; }; X.prototype.v = 300; function Y() {}
  inherit(H, B); inherit(G, H); inherit(S, H);
  B.prototype.m = function () { return 1 + (this.n | 0); }; B.prototype.v = 3;
  function sum(list) { let total = 0; for (let i = 0; i < list.length; i++) total += list[i].m() * 2 + list[i].v; return total; }
  const list = [new G(1), new G(2)];
  log.push("never"); say(() => { if (process.argv.length > 99) H.prototype.__proto__ = X.prototype; });
  for (let k = 0; k < 2; k++) { say(() => sum(list)); say(() => new H(3).m()); say(() => new S(4).m() + new S(5).v); }
})();
(function () {
  function inherit(heir, base) { function Link() {} Link.prototype = base.prototype; heir.prototype = new Link(); heir.prototype.constructor = heir; }
  function B(n) { this.n = n; } function H(n) { B.call(this, n); } function G(n) { H.call(this, n); } function S(n) { H.call(this, n); }
  function X() {} X.prototype.m = function () { return 100; }; X.prototype.v = 300; function Y() {}
  inherit(H, B); inherit(G, H); inherit(S, H);
  B.prototype.m = function () { return 1 + (this.n | 0); }; B.prototype.v = 3;
  function sum(list) { let total = 0; for (let i = 0; i < list.length; i++) total += list[i].m() * 2 + list[i].v; return total; }
  const list = [new G(1), new G(2)];
  log.push("done"); say(() => { Object.setPrototypeOf(H.prototype, X.prototype); });
  for (let k = 0; k < 2; k++) { say(() => sum(list)); say(() => new H(3).m()); say(() => new S(4).m() + new S(5).v); }
})();
console.log(log.join("\n"));
