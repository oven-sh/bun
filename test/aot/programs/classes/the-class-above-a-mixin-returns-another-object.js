// The constructor of the class above returns an object of its own, so the fields and private names of the classes below land there; twice on one object throws.
const lines = [];
let handedBack = null;
class Base { constructor() { if (handedBack) return handedBack; this.own = 1; } }
const Stamped = (Parent) => class extends Parent { stamp = 7; #mark = 1; static has(value) { return #mark in value; } bump() { return ++this.#mark; } };
class A extends Stamped(Base) { last = 9; }
const first = new A();
lines.push(first.own, first.stamp, first.last, A.has(first), first.bump());
const target = { plain: true };
handedBack = target;
const second = new A();
lines.push(second === target, target.stamp, target.last, A.has(target), second instanceof A, A.prototype.bump.call(target));
try { new A(); lines.push("again"); } catch (error) { lines.push(error.constructor.name); }
handedBack = first;
try { new A(); lines.push("again"); } catch (error) { lines.push(error.constructor.name); }
handedBack = Object.freeze({});
try { new A(); lines.push("frozen"); } catch (error) { lines.push(error.constructor.name); }
handedBack = null;
let sum = 0; for (let i = 0; i < 300; i++) { if (i === 150) handedBack = { at: i }; const made = new A(); sum += A.prototype.bump.call(made) + (made.own || 0) + (made.at || 0); handedBack = null; }
lines.push(sum);
console.log(lines.join(" "));
