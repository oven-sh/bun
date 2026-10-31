// The function that is handed the object gets a second name for it: from a call that returns it, from `arguments`, from a rest parameter, from `this` in an arrow,
// from a bound function, from a catch clause, from a generator, from a getter. The store goes through the second name, two calls away from the maker of the object.
const results = [];
function check(name, make) {
  results.push(name + ":" + make() + ":" + make());
}

function same(o) { return o; }
function innerReturned(q) { same(q).x = 1; }
function middleReturned(o) { innerReturned(o); }
check("returned", () => { const o = { x: 0 }; middleReturned(o); return o.x; });

function changeFirst(list) { list[0].x = 2; }
function innerArguments(q) { changeFirst(arguments); }
function middleArguments(o) { innerArguments(o); }
check("arguments", () => { const o = { x: 0 }; middleArguments(o); return o.x; });

function innerRest(...rest) { changeFirst(rest); }
function middleRest(o) { innerRest(o); }
check("rest", () => { const o = { x: 0 }; middleRest(o); return o.x; });

class Counter {
  x = 0;
  bump() { const change = () => { this.x = 3; }; change(); }
}
function middleThis(o) { o.bump(); }
check("this", () => { const o = new Counter(); middleThis(o); return o.x; });

function changeGiven(p) { p.x = 4; }
function innerBound(q) { const bound = changeGiven.bind(null, q); bound(); }
function middleBound(o) { innerBound(o); }
check("bound", () => { const o = { x: 0 }; middleBound(o); return o.x; });

function innerThrown(q) { try { throw q; } catch (caught) { caught.x = 5; } }
function middleThrown(o) { innerThrown(o); }
check("thrown", () => { const o = { x: 0 }; middleThrown(o); return o.x; });

function* each(q) { yield q; }
function innerGenerator(q) { for (const p of each(q)) p.x = 6; }
function middleGenerator(o) { innerGenerator(o); }
check("generator", () => { const o = { x: 0 }; middleGenerator(o); return o.x; });

function innerGetter(q) { const holder = { get it() { return q; } }; holder.it.x = 7; }
function middleGetter(o) { innerGetter(o); }
check("getter", () => { const o = { x: 0 }; middleGetter(o); return o.x; });

function innerSpread(q) { const box = { ...{ o: q } }; box.o.x = 8; }
function middleSpread(o) { innerSpread(o); }
check("spread", () => { const o = { x: 0 }; middleSpread(o); return o.x; });

function innerPattern(q) { const [{ o: p }] = [{ o: q }]; p.x = 9; }
function middlePattern(o) { innerPattern(o); }
check("pattern", () => { const o = { x: 0 }; middlePattern(o); return o.x; });

let kept = null;
function changeKept() { kept.x = 10; }
function innerGlobal(q) { kept = q; changeKept(); kept = null; }
function middleGlobal(o) { innerGlobal(o); }
check("variable of the module", () => { const o = { x: 0 }; middleGlobal(o); return o.x; });

function innerLoop(q) {
  const made = [];
  for (let round = 0; round < 3; round++) made.push(() => { q.x += round; });
  for (const each of made) each();
}
function middleLoop(o) { innerLoop(o); }
check("closures of a loop", () => { const o = { x: 10 }; middleLoop(o); return o.x; });

console.log(results.join("\n"));
