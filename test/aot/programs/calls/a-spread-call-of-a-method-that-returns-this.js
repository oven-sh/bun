class Q {
  parts = [];
  add(...xs) { this.parts.push(...xs); return this; }
  done() { return this.parts.length; }
}
const more = [1, 2];
console.log(new Q().add(...more).done());
const q = new Q();
q.add(...more).n = 1;
console.log(q.n, Object.keys(q).join());
function Emitter() { this.heard = []; }
Emitter.prototype.on = function (name, f) { this.heard.push(name); return this; };
Emitter.prototype.addListener = function (...a) { return this.on(...a); };
Emitter.prototype.count = function () { return this.heard.length; };
console.log(new Emitter().addListener("x", () => 1).addListener(...["y", () => 2]).count());
