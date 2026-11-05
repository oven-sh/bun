// The first stores into a new object are listed where the object is made, and the allocation comes to stand where the last of them stood.
// Objects made inside one another and beside one another, with their stores in every order: what runs in between runs in the order of the text, and every object holds what plain Bun's holds.
const log = [];
const say = (what, value) => { log.push(what); return value; };
const show = (name, make) => {
  log.length = 0;
  let made;
  try { made = JSON.stringify(make()); } catch (error) { made = "threw " + error.constructor.name + " " + error.message; }
  console.log(name, made, log.join(" "));
};

show("one inside another", () => ({ a: say("a", 1), inner: { b: say("b", 2), inmost: { c: say("c", 3) }, d: say("d", 4) }, e: say("e", 5) }));
show("beside smaller ones", () => ({ small: { x: say("x", 1) }, list: [say("l", 2), { y: say("y", 3) }], inner: { small: { x: say("x2", 4) }, inner: 5 } }));
show("two right behind one another", () => { const a = {}; const b = {}; a.x = say("ax", 1); b.y = say("by", 2); return [a, b]; });
show("three right behind one another", () => { const a = {}, b = {}, c = {}; c.z = say("cz", 3); b.y = say("by", 2); a.x = say("ax", 1); return [a, b, c]; });
show("stored into the first, then filled", () => { const a = {}; const b = {}; a.inner = b; b.x = say("bx", 1); a.last = say("al", 2); return a; });
show("stored into the first, filled behind its last store", () => { const a = {}; const b = {}; a.inner = b; a.last = say("al", 2); b.x = say("bx", 1); return a; });
show("filled by turns", () => { const a = {}; const b = {}; a.p = say("ap", 1); b.p = say("bp", 2); a.q = say("aq", 3); b.q = say("bq", 4); a.b = b; b.r = say("br", 5); return a; });
show("the outer one inside the inner one", () => { const a = {}; const b = { up: a }; a.x = say("ax", 1); b.y = say("by", 2); return [Object.keys(a), Object.keys(b), b.up === a]; });
show("a ring", () => { const a = {}; const b = { up: a }; a.down = b; a.x = 1; b.y = 2; return [a.down === b, b.up === a, a.x, b.y]; });
show("itself", () => { const a = {}; a.x = 1; a.self = a; a.y = 2; return [a.self === a, a.x, a.y]; });
show("one name twice", () => { const a = {}; a.x = say("first", 1); a.x = say("second", 2); a.y = say("y", 3); return a; });
show("one name three times", () => { const a = { x: say("zeroth", 0) }; a.x = say("first", 1); a.y = say("y", 3); a.x = say("second", 2); return a; });
show("read between its stores", () => { const a = {}; a.x = say("x", 1); const seen = a.x; a.y = say("y", seen + 1); return a; });
show("handed on between its stores", () => { const a = {}; a.x = 1; const keys = say("keys", Object.keys(a).join()); a.y = 2; return [a, keys]; });
show("the inner one handed on before the outer one has it", () => { const a = {}; const b = {}; b.x = 1; const keys = say("keys", Object.keys(b).join()); b.y = 2; a.inner = b; a.z = 3; return [a, keys]; });
show("a call that throws between the stores", () => { const a = { before: say("before", 1) }; const kept = [a]; try { a.x = say("x", 2); a.y = (() => { throw new RangeError("no"); })(); a.z = say("z", 3); } catch { log.push("caught"); } return kept; });
show("a setter above the object", () => { const above = { set x(value) { log.push("set " + value); } }; const a = { __proto__: above, w: say("w", 0) }; a.x = say("x", 1); a.y = say("y", 2); return [a, Object.keys(a)]; });
show("another prototype between the stores", () => { const a = { p: say("p", 1), __proto__: { q: "above" }, r: say("r", 2) }; a.s = say("s", 3); return [a, a.q]; });
show("in both arms", () => { const a = {}; if (say("test", log.length < 9)) { a.x = say("x", 1); a.inner = { y: say("y", 2) }; } else a.z = 3; a.last = say("last", 4); return a; });
show("in a loop", () => { const all = []; for (let i = 0; i < 3; i++) { const a = {}; const b = { i }; a.b = b; b.twice = say("t" + i, i * 2); a.i = i; all.push(a); } return all; });
show("many levels", () => { let text = "1"; for (let i = 0; i < 40; i++) text = `{ small: { x: say("s${i}", ${i}) }, list: [${i}, { y: 2 }], inner: ${text} }`; return new Function("say", "return " + text)(say).inner.inner.small; });
const deep = { l1: { a: say("1", 1), l2: { b: say("2", 2), l3: { c: say("3", 3), l4: { d: say("4", 4), l5: { e: say("5", 5) }, f: say("6", 6) }, g: say("7", 7) }, h: say("8", 8) }, i: say("9", 9) } };
console.log("at the top", JSON.stringify(deep), log.slice(-9).join(" "));
