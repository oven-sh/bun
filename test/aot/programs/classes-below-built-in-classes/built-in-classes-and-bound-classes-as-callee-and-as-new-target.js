// Classes below Array, Error, Promise and Map, those built-in classes themselves, and bound classes stand as callee and as new.target beside classes of the program.
const lines = [];
const chain = o => { const names = []; for (let p = Object.getPrototypeOf(o); p; p = Object.getPrototypeOf(p)) names.push(Object.hasOwn(p, "constructor") && typeof p.constructor === "function" ? p.constructor.name : "?"); return names.join("<"); };
const say = (what, made) => lines.push(what + ": " + (made === null || typeof made !== "object" ? String(made) : chain(made) + " | " + Reflect.ownKeys(made).map(String).join() + " | " + JSON.stringify(made)));
const attempt = (what, f) => { try { say(what, f()); } catch (error) { lines.push(what + ": " + error.constructor.name + ": " + error.message); } };
const again = (turns, f) => { let made; for (let i = 0; i < turns; i++) made = f(i); return made; };
class Base { a = 1; constructor(x) { this.x = x; } }
class Below extends Base { b = 2; }
class List extends Array { kind = "list"; }
class Failure extends Error { code = 7; }
class Task extends Promise { }
class Table extends Map { rows = 0; }
class Deep extends List { deep = true; }
const byValue = (C, ...rest) => new C(...rest);
const executor = resolve => resolve(1);
const builtIns = [[List, 3], [Deep, 2], [Failure, "text"], [Task, executor], [Table, [[1, 2]]]];
for (const round of [0, 1]) for (const [C, argument] of builtIns) attempt("new " + C.name + " " + round, () => { const made = again(30, () => byValue(C, argument)); return { chain: chain(made), keys: Reflect.ownKeys(made).map(String).join(), isArray: Array.isArray(made), size: made.size, length: made.length, message: made.message }; });
for (const [C] of builtIns) { attempt("Base for " + C.name, () => again(30, i => Reflect.construct(Base, [i], C))); attempt("Below for " + C.name, () => again(30, i => Reflect.construct(Below, [i], C))); }
for (const [C, argument] of builtIns) for (const target of [Base, Below]) attempt(C.name + " for " + target.name, () => { const made = again(30, () => Reflect.construct(C, [argument], target)); return { chain: chain(made), keys: Reflect.ownKeys(made).map(String).join(), isArray: Array.isArray(made) }; });
for (const parent of [Array, Error, Map, Promise, Object, Date, RegExp]) for (const target of [Base, Below]) attempt(parent.name + " itself for " + target.name, () => { const made = again(30, () => Reflect.construct(parent, parent === Promise ? [executor] : [], target)); return { chain: chain(made), tag: Object.prototype.toString.call(made) }; });
const BoundBase = Base.bind(null, 9), BoundBelow = Below.bind({ ignored: 1 }), Twice = BoundBelow.bind(null, 8);
for (const [name, C] of Object.entries({ BoundBase, BoundBelow, Twice })) {
  attempt("new " + name, () => again(30, i => byValue(C, i)));
  attempt("Base for " + name, () => again(30, i => Reflect.construct(Base, [i], C)));
  attempt(name + " for Below", () => again(30, i => Reflect.construct(C, [i], Below)));
  attempt(name + " for Base", () => again(30, i => Reflect.construct(C, [i], Base)));
  attempt(name + " for itself", () => again(30, i => Reflect.construct(C, [i], C)));
  lines.push(String(byValue(C, 1) instanceof C), String(byValue(C, 1) instanceof Base), String("prototype" in C));
}
attempt("below a bound class", () => { class BelowBound extends BoundBase { c = 3; } return again(30, i => byValue(BelowBound, i)); });
BoundBase.prototype = Base.prototype;
attempt("below a bound class that was given a prototype", () => { class BelowBound extends BoundBase { c = 3; } return again(30, i => byValue(BelowBound, i)); });
attempt("Base for a bound class that was given a prototype", () => again(30, i => Reflect.construct(Base, [i], BoundBase)));
BoundBase.prototype = Below.prototype;
attempt("Base for a bound class with the prototype of Below", () => again(30, i => Reflect.construct(Base, [i], BoundBase)));
attempt("Base called", () => Base(1));
attempt("Below called", () => Below.call({}, 1));
console.log(lines.join("\n"));
