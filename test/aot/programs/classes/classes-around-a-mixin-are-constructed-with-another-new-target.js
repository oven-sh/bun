// Reflect.construct with the classes above, between and below as new.target, and new.target read in each constructor.
const lines = [];
class Base { constructor() { this.seen = [new.target.name || "(none)"]; } base = 1; }
const Mid = (Parent) => class extends Parent { constructor(...list) { super(...list); this.seen.push(new.target.name || "(none)"); } mid = 2; #m = 3; m() { return this.#m; } };
class A extends Mid(Base) { constructor() { super(); this.seen.push(new.target.name); } a = 4; }
class Z extends Mid(Base) { z = 5; }
function Old() {} Old.prototype.tag = "old";
const MidA = Object.getPrototypeOf(A);
for (const [K, T] of [[A, A], [A, Z], [A, Base], [A, Old], [MidA, A], [MidA, Z], [Base, A], [Base, MidA], [Z, A], [Z, Old]]) {
  const made = Reflect.construct(K, [], T);
  let m; try { m = MidA.prototype.m.call(made); } catch (error) { m = error.constructor.name; }
  lines.push([made.seen.join("/"), Object.keys(made).join(""), made instanceof A, made instanceof Z, made.tag, m].join(","));
}
console.log(lines.join(" | "));
