// What is known of a generator function's `prototype` is kept for each function of the program, so each scene has a function text of its own: generators are made first, then somebody asks.
const hide = (0, eval)("x => x // ".slice(0, process.argv.length > 1000 ? 1 : 6));
const generatorPrototype = Object.getPrototypeOf(function* () {}).prototype;
const out = [];
const scene = (name, run) => { try { out.push(name + ": " + JSON.stringify(run())); } catch (error) { out.push(name + ": " + error.constructor.name + ": " + error.message); } };
const plain = (g, f) => [Object.getPrototypeOf(g) === f.prototype, Object.getPrototypeOf(f.prototype) === generatorPrototype, Reflect.ownKeys(f.prototype).length];

scene("two closures of one text, the other one is asked", () => {
  const make = () => hide(function* () { yield 1; });
  const f1 = make(), f2 = make(), g1 = hide(f1()), g2 = hide(f2());
  const asked = hide(f2.prototype);
  const f3 = make(), g3 = hide(f3());
  return [asked === Object.getPrototypeOf(g2), plain(g1, f1), plain(g2, f2), plain(g3, f3), f1.prototype !== f2.prototype, f3.prototype !== f1.prototype, plain(hide(f1()), f1)];
});
scene("another text is asked", () => {
  const f = hide(function* () { yield 1; }), other = hide(function* () { yield 2; }), g = hide(f()), h = hide(other());
  hide(other.prototype).mark = "other";
  return [g.mark, h.mark, plain(g, f), Object.getPrototypeOf(h) === other.prototype];
});
scene("the prototype is replaced by an object", () => {
  const f = hide(function* () { yield 1; }), g = hide(f()), next = { mark: "new" };
  f.prototype = next;
  const first = Object.getPrototypeOf(g), later = hide(f());
  return [first !== next, Object.getPrototypeOf(first) === generatorPrototype, Reflect.ownKeys(first).length, g.mark, later.mark, Object.getPrototypeOf(later) === next, typeof later.next, g.next().value];
});
scene("the prototype is replaced by a number", () => {
  const f = hide(function* () { yield 1; }), g = hide(f());
  f.prototype = 5;
  const first = Object.getPrototypeOf(g), later = hide(f());
  return [typeof first, first !== generatorPrototype, Object.getPrototypeOf(first) === generatorPrototype, Object.getPrototypeOf(later) === generatorPrototype, later.next().value];
});
scene("the prototype is defined anew", () => {
  const f = hide(function* () { yield 1; }), g = hide(f()), next = { mark: "defined" };
  Object.defineProperty(f, "prototype", { value: next, writable: false });
  return [g.mark, Object.getPrototypeOf(g) !== next, hide(f()).mark, Object.getOwnPropertyDescriptor(f, "prototype").writable];
});
const asks = {
  getOwnPropertyNames: f => Object.getOwnPropertyNames(f).sort().join(),
  ownKeys: f => Reflect.ownKeys(f).length,
  hasOwnProperty: f => Object.prototype.hasOwnProperty.call(f, "prototype"),
  hasOwn: f => Object.hasOwn(f, "prototype"),
  in: f => "prototype" in f,
  descriptor: f => Object.keys(Object.getOwnPropertyDescriptor(f, "prototype")).join(),
  descriptors: f => Object.keys(Object.getOwnPropertyDescriptors(f)).sort().join(),
  freeze: f => Object.isFrozen(Object.freeze(f)),
  seal: f => Object.isSealed(Object.seal(f)),
  spread: f => Object.keys({ ...f }).length,
  "a key of the run": f => typeof f[hide("proto" + "type")],
  "Reflect.get": f => typeof Reflect.get(f, "prototype"),
  delete: f => Reflect.deleteProperty(f, "prototype"),
  "instanceof": (f, g) => g instanceof f,
  isPrototypeOf: (f, g) => generatorPrototype.isPrototypeOf(g),
  ["__proto__"]: (f, g) => typeof g.__proto__,
  "Reflect.getPrototypeOf": (f, g) => typeof Reflect.getPrototypeOf(g),
  "a property on the function": f => { f.tag = 1; return hide(f()).next().value; },
  "Reflect.construct with it as new.target": f => Object.getPrototypeOf(Reflect.construct(Object, [], f)) === f.prototype,
};
// One text for all of them would be asked once only.
const compiled = [
  () => hide(function* () { yield 0; }), () => hide(function* () { yield 1; }), () => hide(function* () { yield 2; }), () => hide(function* () { yield 3; }), () => hide(function* () { yield 4; }),
  () => hide(function* () { yield 5; }), () => hide(function* () { yield 6; }), () => hide(function* () { yield 7; }), () => hide(function* () { yield 8; }), () => hide(function* () { yield 9; }),
  () => hide(function* () { yield 10; }), () => hide(function* () { yield 11; }), () => hide(function* () { yield 12; }), () => hide(function* () { yield 13; }), () => hide(function* () { yield 14; }),
  () => hide(function* () { yield 15; }), () => hide(function* () { yield 16; }), () => hide(function* () { yield 17; }), () => hide(function* () { yield 18; }),
];
Object.entries(asks).forEach(([name, ask], index) => scene("asked by " + name, () => {
  const f = compiled[index](), fresh = hide(f()), begun = hide(f()), finished = hide(f());
  begun.next(); [...finished];
  const said = ask(f, fresh);
  return [said, plain(fresh, f), plain(begun, f), plain(finished, f), plain(hide(f()), f), fresh.next().value, begun.next().done];
}));
scene("as many texts as ways", () => compiled.length === Object.keys(asks).length);
scene("the generator is a prototype itself", () => {
  const f = hide(function* () { yield 1; }), g = hide(f()), below = hide(Object.create(g));
  return [typeof below.next, Object.getPrototypeOf(below) === g, Object.getPrototypeOf(Object.getPrototypeOf(below)) === f.prototype, plain(g, f)];
});
scene("the generator has properties, or is closed", () => {
  const f = hide(function* () { yield 1; }), own = hide(f()), frozen = hide(f()), closed = hide(f()), sealed = hide(f());
  own.mine = 1; own[0] = "zero"; Object.freeze(frozen); Object.preventExtensions(closed); Object.seal(sealed);
  return [plain(own, f), plain(frozen, f), plain(closed, f), plain(sealed, f), own.mine, own[0], Object.isFrozen(frozen), Object.isExtensible(closed), Reflect.setPrototypeOf(closed, f.prototype), Reflect.setPrototypeOf(closed, {})];
});
scene("asked from inside the body, while it runs", () => {
  const seen = [];
  const f = hide(function* inner() { seen.push(Object.getPrototypeOf(self) === inner.prototype); yield 1; seen.push(self instanceof inner); });
  const self = hide(f()), waiting = hide(f.call(null));
  self.next(); self.next();
  return [seen, Object.getPrototypeOf(waiting) === f.prototype];
});
scene("many, and a collection in front of the question", () => {
  const make = () => hide(function* () { yield 1; });
  const kept = [];
  for (let i = 0; i < 20000; i++) { const f = make(), g = f(); if (i % 1000 === 0) kept.push([f, hide(g)]); }
  Bun.gc(true);
  return kept.map(([f, g]) => plain(g, f).join()).filter((text, index, all) => all.indexOf(text) === index);
});
scene("its own prototype is set, then the function is asked", () => {
  const f = hide(function* () { yield 1; }), g = hide(f()), other = hide(f()), mine = { mark: "mine" };
  Object.setPrototypeOf(g, mine);
  return [g.mark, Object.getPrototypeOf(g) === mine, plain(other, f), typeof g.next];
});
console.log(out.join("\n"));
