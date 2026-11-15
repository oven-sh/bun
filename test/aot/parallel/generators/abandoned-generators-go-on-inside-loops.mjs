// STATISTIC: GeneratorFramesBuilt >= 23
// A hidden override keeps, steps and leaves a generator that stands at a yield inside its own loops.
const notes = [], kept = [];
const pick = name => (process.argv.length < 0 ? "" : name);
const show = v => JSON.stringify(v, (k, x) => (x === undefined ? "u" : x));
const engines = Object.getPrototypeOf(Object.getPrototypeOf((function* () {})()));
class Own {
  constructor(how) { this.how = how; this.n = 0; }
  [Symbol.iterator]() { return this; }
  next(v) { return { done: this.n++ > 2, value: this.how + this.n }; }
  get return() { notes.push("gr"); return this.how === "quiet" ? undefined : v => { notes.push("r"); return {}; }; }
}
const list0 = [11, 12, 13], map0 = new Map([["o", 1], ["q", 2], ["r", 3]]);
function* inner(limit) { try { for (let i = 0; i < limit; i++) yield "i" + i; return "end"; } finally { notes.push("c"); } }
const experiments = {
  lists(override) {
    function* items(limit, given) { let total = limit; for (const x of [limit, 7, 8]) yield x; return [total, limit]; }
    console.log(show(items(2, [1]).next().value));
    const hidden = { get value() { Reflect.set(items.prototype, pick("return"), override); return 1; } };
    return given => { let n = 0; for (const v of items(3, given())) { n += hidden.value; if (n > 1) break; } return n; };
  },
  holes(override) {
    function* items(limit, given) { let total = limit; const list = [4, , 6]; for (const x of list) { yield x; if (x === 4) list.push(9); } return [total, limit]; }
    console.log(show(items(2, [1]).next().value));
    const hidden = { get value() { Reflect.set(items.prototype, pick("return"), override); return 1; } };
    return given => { let n = 0; for (const v of items(3, given())) { n += hidden.value; if (n > 1) break; } return n; };
  },
  entries(override) {
    function* items(limit, given) { let total = limit; for (const [k, v] of ["a", "b", "c"].entries()) yield k + v; return [total, limit]; }
    console.log(show(items(2, [1]).next().value));
    const hidden = { get value() { Reflect.set(items.prototype, pick("return"), override); return 1; } };
    return given => { let n = 0; for (const v of items(3, given())) { n += hidden.value; if (n > 1) break; } return n; };
  },
  kept(override) {
    function* items(limit, given) { let total = limit; for (const x of list0) yield x; return [total, limit]; }
    console.log(show(items(2, [1]).next().value));
    const hidden = { get value() { Reflect.set(items.prototype, pick("return"), override); return 1; } };
    return given => { let n = 0; for (const v of items(3, given())) { n += hidden.value; if (n > 1) break; } return n; };
  },
  keys(override) {
    function* items(limit, given) { let total = limit; for (const x of list0.keys()) yield x; return [total, limit]; }
    console.log(show(items(2, [1]).next().value));
    const hidden = { get value() { Reflect.set(items.prototype, pick("return"), override); return 1; } };
    return given => { let n = 0; for (const v of items(3, given())) { n += hidden.value; if (n > 1) break; } return n; };
  },
  views(override) {
    function* items(limit, given) { let total = limit; for (const x of Float64Array.of(0.5, -1, 2)) yield x; return [total, limit]; }
    console.log(show(items(2, [1]).next().value));
    const hidden = { get value() { Reflect.set(items.prototype, pick("return"), override); return 1; } };
    return given => { let n = 0; for (const v of items(3, given())) { n += hidden.value; if (n > 1) break; } return n; };
  },
  texts(override) {
    function* items(limit, given) { let total = limit; for (const c of "a\u{1F600}b" + limit) yield c; return [total, limit]; }
    console.log(show(items(2, [1]).next().value));
    const hidden = { get value() { Reflect.set(items.prototype, pick("return"), override); return 1; } };
    return given => { let n = 0; for (const v of items(3, given())) { n += hidden.value; if (n > 1) break; } return n; };
  },
  maps(override) {
    function* items(limit, given) { let total = limit; const map = new Map([[1, limit], [2, "two"], [3, null]]); for (const [k, v] of map) { yield k + ":" + v; map.delete(3); if (map.size < 4) map.set("n" + map.size, k); } return [total, limit]; }
    console.log(show(items(2, [1]).next().value));
    const hidden = { get value() { Reflect.set(items.prototype, pick("return"), override); return 1; } };
    return given => { let n = 0; for (const v of items(3, given())) { n += hidden.value; if (n > 1) break; } return n; };
  },
  values(override) {
    function* items(limit, given) { let total = limit; for (const x of map0.values()) yield x; return [total, limit]; }
    console.log(show(items(2, [1]).next().value));
    const hidden = { get value() { Reflect.set(items.prototype, pick("return"), override); return 1; } };
    return given => { let n = 0; for (const v of items(3, given())) { n += hidden.value; if (n > 1) break; } return n; };
  },
  sets(override) {
    function* items(limit, given) { let total = limit; const set = new Set([1, 2, 3]); for (const x of set) { yield x; set.delete(x); if (x < 4) set.add(x + 3); } return [total, limit]; }
    console.log(show(items(2, [1]).next().value));
    const hidden = { get value() { Reflect.set(items.prototype, pick("return"), override); return 1; } };
    return given => { let n = 0; for (const v of items(3, given())) { n += hidden.value; if (n > 1) break; } return n; };
  },
  names(override) {
    function* items(limit, given) { let total = limit; const o = { a: 1, b: limit, c: 3 }; for (const k in o) { yield k; delete o.c; } return [total, limit]; }
    console.log(show(items(2, [1]).next().value));
    const hidden = { get value() { Reflect.set(items.prototype, pick("return"), override); return 1; } };
    return given => { let n = 0; for (const v of items(3, given())) { n += hidden.value; if (n > 1) break; } return n; };
  },
  inherited(override) {
    function* items(limit, given) { let total = limit; for (const k in Object.create({ up: 1 }, { own: { enumerable: true, value: 2 } })) yield k; return [total, limit]; }
    console.log(show(items(2, [1]).next().value));
    const hidden = { get value() { Reflect.set(items.prototype, pick("return"), override); return 1; } };
    return given => { let n = 0; for (const v of items(3, given())) { n += hidden.value; if (n > 1) break; } return n; };
  },
  places(override) {
    function* items(limit, given) { let total = limit; for (const k in [7, 8, 9]) yield k + limit; return [total, limit]; }
    console.log(show(items(2, [1]).next().value));
    const hidden = { get value() { Reflect.set(items.prototype, pick("return"), override); return 1; } };
    return given => { let n = 0; for (const v of items(3, given())) { n += hidden.value; if (n > 1) break; } return n; };
  },
  own(override) {
    function* items(limit, given) { let total = limit; for (const x of new Own("own")) yield x; return [total, limit]; }
    console.log(show(items(2, [1]).next().value));
    const hidden = { get value() { Reflect.set(items.prototype, pick("return"), override); return 1; } };
    return given => { let n = 0; for (const v of items(3, given())) { n += hidden.value; if (n > 1) break; } return n; };
  },
  quiet(override) {
    function* items(limit, given) { let total = limit; for (const x of new Own("quiet")) { try { yield x; } finally { notes.push("f"); } } return [total, limit]; }
    console.log(show(items(2, [1]).next().value));
    const hidden = { get value() { Reflect.set(items.prototype, pick("return"), override); return 1; } };
    return given => { let n = 0; for (const v of items(3, given())) { n += hidden.value; if (n > 1) break; } return n; };
  },
  generators(override) {
    function* items(limit, given) { let total = limit; for (const x of inner(3)) { const got = yield x; if (got === 5) break; } return [total, limit]; }
    console.log(show(items(2, [1]).next().value));
    const hidden = { get value() { Reflect.set(items.prototype, pick("return"), override); return 1; } };
    return given => { let n = 0; for (const v of items(3, given())) { n += hidden.value; if (n > 1) break; } return n; };
  },
  given(override) {
    function* items(limit, given) { let total = limit; for (const x of given) yield x; return [total, limit]; }
    console.log(show(items(2, [1]).next().value));
    const hidden = { get value() { Reflect.set(items.prototype, pick("return"), override); return 1; } };
    return given => { let n = 0; for (const v of items(3, given())) { n += hidden.value; if (n > 1) break; } return n; };
  },
  matches(override) {
    function* items(limit, given) { let total = limit; for (const m of "a1b22c".matchAll(/\d+/g)) yield m[0]; return [total, limit]; }
    console.log(show(items(2, [1]).next().value));
    const hidden = { get value() { Reflect.set(items.prototype, pick("return"), override); return 1; } };
    return given => { let n = 0; for (const v of items(3, given())) { n += hidden.value; if (n > 1) break; } return n; };
  },
  both(override) {
    function* items(limit, given) { let total = limit; for (const y of [1, 2]) for (const k in { u: 1, w: 2 }) yield y + k; return [total, limit]; }
    console.log(show(items(2, [1]).next().value));
    const hidden = { get value() { Reflect.set(items.prototype, pick("return"), override); return 1; } };
    return given => { let n = 0; for (const v of items(3, given())) { n += hidden.value; if (n > 1) break; } return n; };
  },
  outer(override) {
    function* items(limit, given) { let total = limit; outer: for (const y of given) { for (const z of [y, limit]) { yield z; if (z === limit) continue outer; } } return [total, limit]; }
    console.log(show(items(2, [1]).next().value));
    const hidden = { get value() { Reflect.set(items.prototype, pick("return"), override); return 1; } };
    return given => { let n = 0; for (const v of items(3, given())) { n += hidden.value; if (n > 1) break; } return n; };
  },
  delegates(override) {
    function* items(limit, given) { let total = limit; for (const y of [1, 2]) yield* [y, limit]; return [total, limit]; }
    console.log(show(items(2, [1]).next().value));
    const hidden = { get value() { Reflect.set(items.prototype, pick("return"), override); return 1; } };
    return given => { let n = 0; for (const v of items(3, given())) { n += hidden.value; if (n > 1) break; } return n; };
  },
  handsOn(override) {
    function* items(limit, given) { let total = limit; const got = yield* inner(2); notes.push("got " + got); yield* new Own("own"); yield* "xy"; return [total, limit]; }
    console.log(show(items(2, [1]).next().value));
    const hidden = { get value() { Reflect.set(items.prototype, pick("return"), override); return 1; } };
    return given => { let n = 0; for (const v of items(3, given())) { n += hidden.value; if (n > 1) break; } return n; };
  },
  patterns(override) {
    function* items(limit, given) { let total = limit; for (let i = 0; i < limit; i++) { const [x = "d", y = "e"] = [i]; yield { x }; notes.push(y); } return [total, limit]; }
    console.log(show(items(2, [1]).next().value));
    const hidden = { get value() { Reflect.set(items.prototype, pick("return"), override); return 1; } };
    return given => { let n = 0; for (const v of items(3, given())) { n += hidden.value; if (n > 1) break; } return n; };
  },
  parts(override) {
    function* items(limit, given) { let total = limit; for (const { x, y = x } of [{ x: 1 }, { x: 2, y: 3 }, { x: 4 }]) yield x + y; return [total, limit]; }
    console.log(show(items(2, [1]).next().value));
    const hidden = { get value() { Reflect.set(items.prototype, pick("return"), override); return 1; } };
    return given => { let n = 0; for (const v of items(3, given())) { n += hidden.value; if (n > 1) break; } return n; };
  },
};
const overrides = {
  keeps() { kept.push(this); return {}; },
  steps(value) { notes.push(show(engines.next.call(this, 8)), show(engines.next.call(this, 9))); return engines.return.call(this, value); },
  leaves(value) { notes.push(show(engines.return.call(this, value))); return {}; },
  throws() { try { notes.push(show(engines.throw.call(this, new Error("into")))); } catch (e) { notes.push(e.message); } kept.push(this); return {}; },
};
const givens = [() => [8, 9, 10], () => new Set(["s", "t", "u"]), () => inner(3), () => "uvw", () => new Own("own")];
for (const [form, experiment] of Object.entries(experiments)) {
  for (const [name, override] of Object.entries(overrides)) {
    for (const given of form === "given" || form === "outer" ? givens : [givens[0]]) {
      console.log(form, name, experiment(override)(given), notes.splice(0).join(" "));
      for (const generator of kept.splice(0)) {
        Bun.gc(true);
        const all = [];
        for (let step = 1; step < 9; step++) all.push(show(step === 4 ? engines.next.call(generator, 5) : engines.next.call(generator, step)));
        console.log("  later", all.join(), show(engines.return.call(generator, 4)), notes.splice(0).join(" "));
      }
    }
  }
}
