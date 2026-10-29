// Heirs, and the holder itself, read, ask for, store to and call a name that lies above them (or in them, or nowhere), by name and by key, often enough for every answer to be remembered. Then the holder, or an object between, changes in one way,
// and they do it all again. Every kind of holder, every way its properties are kept, every state of the name and every change: one line each.
const read = o => o.k, readAgain = o => o.k, has = o => "k" in o, owns = o => Object.hasOwn(o, "k"), call = o => o.k(), write = (o, v) => { o.k = v; }, writeOther = (o, v) => { o.other = v; };
const strictWrite = (o, v) => { "use strict"; o.k = v; };
const readByKey = (o, key) => o[key], hasByKey = (o, key) => key in o, keys = ["k", "before", "after", "nowhere"];
let log = "";
const attempt = run => { try { return run(); } catch (error) { return error instanceof TypeError ? "TypeError" : "Error"; } };
const show = v => (typeof v === "function" ? "function" : typeof v === "object" && v ? "object" : String(v));

function passingNames(p, count) {
  for (let i = 0; i < count; i++) {
    Reflect.set(p, "passing" + i, i);
    if (i) Reflect.deleteProperty(p, "passing" + (i - 1));
  }
}

const holders = {
  "literal": () => { const p = {}; p.tag = 1; return p; },
  "literal with the name": () => ({ tag: 1, k: undefined, last: 2 }),
  "parsed": () => JSON.parse('{"z0":0,"z1":1}'),
  "class prototype": () => (class { tagged() { return 1; } }).prototype,
  "function prototype": () => { function F() {} return F.prototype; },
  "without prototype": () => Object.create(null),
};
const keepings = {
  "fresh": p => {},
  "names came and went": p => passingNames(p, 40),
  "dictionary": p => passingNames(p, 130),
  "packed anew": p => { passingNames(p, 130); writeOther(p, 1); },
  "dictionary again": p => { passingNames(p, 130); writeOther(p, 1); read(Object.create(p)); read(Object.create(p)); passingNames(p, 130); },
};
const accessor = tag => ({ get() { return "got " + tag; }, set(v) { log += tag + v; }, configurable: true, enumerable: true });
const states = {
  "absent": p => { delete p.k; },
  "value": p => Object.defineProperty(p, "k", { value: 296, writable: true, configurable: true, enumerable: true }),
  "method": p => Object.defineProperty(p, "k", { value() { return "called"; }, writable: true, configurable: true, enumerable: false }),
  "accessor": p => Object.defineProperty(p, "k", accessor("a")),
  "read-only": p => Object.defineProperty(p, "k", { value: 5, writable: false, configurable: true, enumerable: true }),
};
const changes = {
  "nothing": w => {},
  "becomes a value": w => Object.defineProperty(w.holder, "k", { value: 7, writable: true, configurable: true, enumerable: true }),
  "becomes an accessor": w => Object.defineProperty(w.holder, "k", accessor("b")),
  "becomes read-only": w => Object.defineProperty(w.holder, "k", { value: 8, writable: false, configurable: true, enumerable: true }),
  "is deleted": w => { delete w.holder.k; },
  "is deleted, another takes its place": w => { Reflect.deleteProperty(w.holder, "k"); Reflect.set(w.holder, "late", 297); Reflect.set(w.holder, "later", 298); },
  "is stored to by name": w => attempt(() => write(w.holder, 9)),
  "names come and go": w => passingNames(w.holder, 61),
  "names come and go, then a store by name": w => { passingNames(w.holder, 131); writeOther(w.holder, 2); },
  "another is deleted, then a store by name": w => { Reflect.set(w.holder, "early", 1); passingNames(w.holder, 131); Reflect.deleteProperty(w.holder, "early"); writeOther(w.holder, 3); },
  "the one between gets the name": w => Object.defineProperty(w.between, "k", { value: "between", writable: true, configurable: true, enumerable: true }),
  "the one between gets an accessor": w => Object.defineProperty(w.between, "k", accessor("c")),
  "the one between gets another prototype": w => Object.setPrototypeOf(w.between, { k: "elsewhere" }),
  "the one between loses its prototype": w => Object.setPrototypeOf(w.between, null),
  "the holder gets a prototype with the name": w => attempt(() => Object.setPrototypeOf(w.holder, { k: "higher" })),
  "the one between is assigned the name": w => Object.assign(w.between, { k: "assigned" }),
  "the holder is assigned the name and others": w => attempt(() => Object.assign(w.holder, { first: 1, k: "assigned", second: 2 })),
  "the one between gets another prototype by __proto__": w => { w.between.__proto__ = { k: "by __proto__" }; },
  "the one between gets another prototype by Reflect": w => Reflect.setPrototypeOf(w.between, { get k() { return "by Reflect"; } }),
  "the holder gets a getter the old way": w => attempt(() => Object.prototype.__defineGetter__.call(w.holder, "k", () => "the old way")),
  "several are defined at once": w => Object.defineProperties(w.holder, { early: { value: 1, configurable: true }, k: { value: "at once", configurable: true, writable: true }, late: accessor("d") }),
  "the holder is frozen": w => Object.freeze(w.holder),
  "the holder is sealed, then stored to": w => { Object.seal(w.holder); attempt(() => write(w.holder, 10)); },
};

function look(w) {
  const seen = [];
  for (const o of w.heirs) {
    seen.push(show(attempt(() => read(o))), has(o) ? "+" : "-", owns(o) ? "o" : ".", show(attempt(() => call(o))), show(attempt(() => readAgain(o))));
    for (const key of keys) seen.push(show(attempt(() => readByKey(o, key))) + (hasByKey(o, key) ? "+" : "-"));
  }
  return seen.join(" ");
}

function store(w, v) {
  const fresh = Object.create(w.between);
  const strict = Object.create(w.between);
  return [show(attempt(() => write(fresh, v))), owns(fresh) ? "o" : ".", show(attempt(() => read(fresh))), show(attempt(() => strictWrite(strict, v))), owns(strict) ? "o" : "."].join(" ");
}

for (const holderKind in holders) {
  for (const keeping in keepings) {
    for (const state in states) {
      for (const change in changes) {
        for (const betweenKind of ["literal", "parsed"]) {
          const holder = holders[holderKind]();
          keepings[keeping](holder);
          // Neighbors of other kinds, so that an answer taken from the wrong place shows.
          Object.defineProperty(holder, "before", { value: 296, writable: true, configurable: true, enumerable: false });
          states[state](holder);
          Object.defineProperty(holder, "after", accessor("n"));
          Reflect.set(holder, "last", "the last neighbor");
          const between = holders[betweenKind]();
          Object.setPrototypeOf(between, holder);
          const w = { holder, between, heirs: [Object.create(between), Object.create(between), Object.create(holder), between, holder] };
          w.heirs[1].own = 1;
          log = "";
          let before = "";
          for (let i = 0; i < 4; i++) before = look(w) + " | " + store(w, i);
          attempt(() => changes[change](w));
          let after = "";
          for (let i = 0; i < 3; i++) after = look(w) + " | " + store(w, i);
          console.log(`${holderKind}, ${keeping}, ${state}, ${change}, below a ${betweenKind}: ${before} => ${after} ${log}`);
        }
      }
    }
  }
}
