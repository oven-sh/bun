// A generator inherits from the `prototype` of its function, an object that hardly anybody ever looks at. It is made when somebody asks: the function, the generator, instanceof, a store.
// Whoever looks, and in whichever order, sees what he would see had it been there from the start. `hide` is a function that the build cannot read: what goes through it has to be a real object.
const hide = (0, eval)("x => x // ".slice(0, process.argv.length > 1000 ? 1 : 6));
const generatorPrototype = Object.getPrototypeOf(function* () {}).prototype;
function make(tag) {
  return hide(function* () {
    const sent = yield tag + 1;
    yield tag + 2;
    return sent;
  });
}
function show(label, run) {
  let answer;
  try {
    answer = JSON.stringify(run());
  } catch (error) {
    answer = "throws " + error.name + ": " + error.message;
  }
  console.log(label + ": " + answer);
}
const stepsByName = hide(g => [g.next().value, g.next("sent").value, g.next().value]);

show("the generator is asked first", () => {
  const f = make("a");
  const g = hide(f());
  const ofGenerator = Object.getPrototypeOf(g);
  return [ofGenerator === f.prototype, Object.getPrototypeOf(ofGenerator) === generatorPrototype, Object.getPrototypeOf(g) === ofGenerator, Reflect.ownKeys(ofGenerator)];
});
show("the function is asked first", () => {
  const f = make("b");
  const g = hide(f());
  const ofFunction = f.prototype;
  return [Object.getPrototypeOf(g) === ofFunction, g.__proto__ === ofFunction, Reflect.getPrototypeOf(g) === ofFunction, ofFunction.isPrototypeOf(g)];
});
show("the function is asked before its first call", () => {
  const f = make("c");
  const ofFunction = f.prototype;
  const g = hide(f());
  return [Object.getPrototypeOf(g) === ofFunction, stepsByName(g)];
});
show("two generators of one function", () => {
  const f = make("d");
  const [first, second] = [hide(f()), hide(f())];
  return [Object.getPrototypeOf(first) === Object.getPrototypeOf(second), Object.getPrototypeOf(second) === f.prototype];
});
show("two functions of one text", () => {
  const [f1, f2] = [make("e"), make("e")];
  const [g1, g2] = [hide(f1()), hide(f2())];
  return [Object.getPrototypeOf(g1) === Object.getPrototypeOf(g2), f1.prototype === f2.prototype, Object.getPrototypeOf(g1) === f1.prototype, Object.getPrototypeOf(g2) === f2.prototype];
});
show("instanceof", () => {
  const [f1, f2] = [make("f"), make("f")];
  const g = hide(f1());
  return [g instanceof f1, g instanceof f2, hide(f2()) instanceof f2, g instanceof Object];
});
show("a function made in a loop", () => {
  const seen = new Set();
  let right = 0;
  for (let i = 0; i < 2000; i++) {
    const f = make(i);
    const g = hide(f());
    stepsByName(g);
    if (i % 100) continue;
    right += i % 200 ? Object.getPrototypeOf(g) === f.prototype : f.prototype === Object.getPrototypeOf(g);
    seen.add(f.prototype);
  }
  return [right, seen.size];
});
show("replaced before the first call", () => {
  const f = make("g");
  const other = { other: true };
  f.prototype = other;
  const g = hide(f());
  return [Object.getPrototypeOf(g) === other, g.other, typeof g.next];
});
show("replaced after the first call", () => {
  const f = make("h");
  const before = hide(f());
  const other = Object.create(generatorPrototype, { other: { value: true } });
  f.prototype = other;
  const after = hide(f());
  const first = Object.getPrototypeOf(before);
  return [first === other, Object.getPrototypeOf(first) === generatorPrototype, Object.getPrototypeOf(after) === other, before.other, after.other, stepsByName(before), stepsByName(after), Object.getPrototypeOf(before) === first];
});
show("asked, then replaced, then asked again", () => {
  const f = make("i");
  const before = hide(f());
  const first = f.prototype;
  f.prototype = {};
  f.prototype = {};
  return [Object.getPrototypeOf(before) === first, before instanceof f, Reflect.ownKeys(f)];
});
show("replaced by a definition", () => {
  const f = make("j");
  const before = hide(f());
  const other = {};
  Object.defineProperty(f, "prototype", { value: other });
  return [Object.getPrototypeOf(before) === other, Object.getPrototypeOf(hide(f())) === other, JSON.stringify(Object.getOwnPropertyDescriptor(f, "prototype"))];
});
show("replaced by a number", () => {
  const f = make("k");
  const before = hide(f());
  f.prototype = 5;
  return [Object.getPrototypeOf(hide(f())) === generatorPrototype, Object.getPrototypeOf(before) === generatorPrototype, Object.getPrototypeOf(Object.getPrototypeOf(before)) === generatorPrototype];
});
show("the generator is given another prototype", () => {
  const f = make("l");
  const g = hide(f());
  const other = { other: true };
  Object.setPrototypeOf(g, other);
  return [Object.getPrototypeOf(g) === other, g.other, typeof g.next, f.prototype === other, g instanceof f];
});
show("the generator is given the prototype that it has", () => {
  const f = make("m");
  const g = hide(f());
  Object.setPrototypeOf(g, f.prototype);
  return [Object.getPrototypeOf(g) === f.prototype, stepsByName(g)];
});
show("names of its own, and frozen", () => {
  const f = make("n");
  const g = hide(f());
  g.own = 1;
  Object.freeze(g);
  return [Object.getPrototypeOf(g) === f.prototype, g.own, Object.isFrozen(g), stepsByName(g)];
});
show("a finished generator", () => {
  const f = make("o");
  const g = hide(f());
  const steps = stepsByName(g);
  g.next();
  return [steps, g.next().done, Object.getPrototypeOf(g) === f.prototype];
});
show("methods", () => {
  class C {
    *m() {
      yield 1;
    }
    static *s() {
      yield 2;
    }
  }
  const o = hide({
    *m() {
      yield 3;
    },
  });
  const c = hide(new C());
  return [Object.getPrototypeOf(hide(c.m())) === C.prototype.m.prototype, Object.getPrototypeOf(hide(C.s())) === C.s.prototype, Object.getPrototypeOf(hide(o.m())) === o.m.prototype, [...c.m(), ...C.s(), ...o.m()]];
});
show("after collections", () => {
  const pairs = [];
  for (let i = 0; i < 300; i++) {
    const f = make("v" + i);
    pairs.push([i % 3 ? f : null, hide(f())]);
  }
  for (let i = 0; i < 3; i++) Bun.gc(true);
  let right = 0;
  for (const [f, g] of pairs) {
    const prototype = Object.getPrototypeOf(g);
    right += Object.getPrototypeOf(prototype) === generatorPrototype && (!f || prototype === f.prototype) && g.next().value.endsWith("1");
  }
  for (let i = 0; i < 3; i++) Bun.gc(true);
  for (const [f, g] of pairs) right += (!f || Object.getPrototypeOf(g) === f.prototype) && g.next().value.endsWith("2");
  return right;
});

// From here on the prototype objects are changed. What was made before has to see it.
const untouched = make("p");
const madeBeforeAnyChange = hide(untouched());
show("a name is added", () => {
  const f = make("q");
  const g = hide(f());
  stepsByName(hide(f()));
  f.prototype.extra = "added";
  return [g.extra, hide(f()).extra, madeBeforeAnyChange.extra, "extra" in g, "extra" in madeBeforeAnyChange];
});
show("next is replaced behind a generator that exists", () => {
  const f = make("r");
  const g = hide(f());
  const h = hide(f());
  const i = hide(f());
  f.prototype.next = function () {
    return { done: true, value: "replaced" };
  };
  function* delegates(to) {
    return yield* to;
  }
  return [g.next(), [...h], hide(delegates(i)).next(), stepsByName(madeBeforeAnyChange), stepsByName(hide(untouched()))];
});
show("what is above the prototype is replaced", () => {
  const f = make("s");
  const g = hide(f());
  Object.setPrototypeOf(f.prototype, { inherited: "from above" });
  return [g.inherited, typeof g.next, Object.getPrototypeOf(g) === f.prototype];
});
show("asked of the generator and changed", () => {
  const f = make("t");
  const g = hide(f());
  const h = hide(f());
  Object.getPrototypeOf(g).viaGenerator = 1;
  return [h.viaGenerator, f.prototype.viaGenerator, hide(f()).viaGenerator];
});
show("functions made after the changes", () => {
  const f = make("u");
  const g = hide(f());
  return [stepsByName(g), Object.getPrototypeOf(g) === f.prototype, g.extra];
});
