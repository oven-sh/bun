// The fields of an object are filled by a method behind its construction (init, reset). Once they are there no read and no store asks again, until the object loses one, is frozen, or is made by other means.
// STATISTIC: InitializersFinishingBirths >= 6
"use strict";
const out = [];
const show = (f) => { try { const r = f(); return r && typeof r === "object" ? JSON.stringify(r) : String(r); } catch (error) { return error.constructor.name; } };
const State = (function () {
  function State() {}
  const proto = State.prototype;
  proto.init = function init(options, input) {
    this.strict = options.strict === false ? false : options.kind === "module";
    this.input = input;
    this.labels = [];
    this.inFunction = this.inMethod = false;
    this.pos = this.lineStart = 0;
    this.curLine = options.startLine;
    this.start = this.end = this.pos;
    this.startLoc = this.endLoc = this.position();
    this.value = null;
    this.context = [0];
  };
  proto.position = function position() { return { line: this.curLine, column: this.pos - this.lineStart }; };
  proto.clone = function clone(skipArrays) {
    const state = new State();
    Object.keys(this).forEach((key) => {
      let value = this[key];
      if ((!skipArrays || key === "context") && Array.isArray(value)) value = value.slice();
      state[key] = value;
    });
    return state;
  };
  return State;
})();
class Reader {
  constructor(options, input) { this.state = new State(); this.state.init(options, input); this.isLookahead = false; this.seen = []; }
  skip() {
    while (this.state.pos < this.state.input.length) {
      const ch = this.state.input.charCodeAt(this.state.pos);
      if (ch === 10) { ++this.state.pos; ++this.state.curLine; this.state.lineStart = this.state.pos; } else if (ch === 32) ++this.state.pos; else break;
    }
  }
  next() {
    this.skip();
    this.state.start = this.state.pos;
    this.state.startLoc = this.state.position();
    while (this.state.pos < this.state.input.length && this.state.input.charCodeAt(this.state.pos) > 32) this.state.pos++;
    this.state.end = this.state.pos;
    this.state.endLoc = this.state.position();
    this.state.value = this.state.input.slice(this.state.start, this.state.end);
    this.state.context.push(this.state.value.length);
    return this.state.value;
  }
  peek() { const old = this.state; this.state = old.clone(true); this.isLookahead = true; this.next(); this.isLookahead = false; const seen = this.state; this.state = old; return seen; }
  all() {
    const words = [];
    for (;;) {
      const ahead = this.peek();
      const word = this.next();
      if (ahead.value !== word || ahead.endLoc.column !== this.state.endLoc.column || ahead.pos !== this.state.pos) words.push("DIFFERS");
      if (!word) break;
      words.push(word + this.state.startLoc.line + ":" + this.state.startLoc.column + "-" + this.state.endLoc.column);
    }
    return words.join(" ") + "|" + this.state.context.join("") + "|" + Object.keys(this.state).join();
  }
}
const text = "one two\n  three four five\nsix  seven\n\n eight nine ten eleven\n twelve";
for (let round = 0; round < 3; round++) out.push(new Reader({ kind: round ? "module" : "script", startLine: round + 1, strict: round === 2 ? false : undefined }, text).all());

// What happens to an object between its initializer and a read.
function makeBox() {
  return class Box {
    init(a) { this.a = a; this.b = a + 1; this.c = a + 2; this.d = [a]; this.e = "e" + a; }
    sum() { let sum = 0; for (let i = 0; i < 3; i++) { sum += this.a + this.b + this.c + this.d.length; this.a += 1; } return sum + this.e; }
    put(v) { this.a = v; this.b = v; this.c = v; return this.a + this.b + this.c; }
  };
}
const fates = {
  nothing(box) {},
  deleted(box) { delete box.b; },
  deletedLast(box) { delete box.e; box.e = "again"; },
  frozen(box) { Object.freeze(box); },
  sealed(box) { Object.seal(box); },
  closed(box) { Object.preventExtensions(box); },
  locked(box) { Object.defineProperty(box, "b", { writable: false }); },
  hidden(box) { Object.defineProperty(box, "c", { enumerable: false }); },
  accessor(box) { let held = 70; Object.defineProperty(box, "a", { get() { return held; }, set(v) { held = v * 2; }, configurable: true, enumerable: true }); },
  otherPrototype(box) { Object.setPrototypeOf(box, { sum: box.sum, put: box.put, b: 900 }); delete box.b; },
  noPrototype(box) { const { sum, put } = box; Object.setPrototypeOf(box, null); box.sum = sum; box.put = put; },
  text(box) { box.a = "text"; },
  missing(box) { box.d = undefined; },
  extra(box) { box.extra = 1; box[3] = 4; },
};
for (const [name, fate] of Object.entries(fates)) {
  const Box = makeBox();
  for (let round = 0; round < 4; round++) {
    const box = new Box();
    if (round !== 3) box.init(round);
    if (round === 1 || round === 3) fate(box);
    out.push([name, round, show(() => box.sum()), show(() => box.put(round + 0.5)), show(() => box.put("s")), Object.getOwnPropertyNames(box).join(), show(() => JSON.stringify(box))].join(" "));
    if (round === 2) { fate(box); out.push(show(() => box.sum()) + show(() => box.put(5)) + show(() => box.init(9)) + show(() => box.sum())); }
  }
}
// Objects that their initializer fills in part, twice, late, or by way of others.
class Partial { init(n) { this.a = n; this.b = n; if (n === 2) throw new RangeError("two"); this.c = n; this.d = n; this.e = n; } sum() { let s = 0; for (let i = 0; i < 4; i++) s += (this.a | 0) + (this.b | 0) + (this.c | 0) + (this.d | 0) + (this.e | 0); return s; } }
for (let i = 0; i < 5; i++) { const p = new Partial(); const r = show(() => p.init(i)); out.push("partial " + i + r + p.sum() + show(() => p.init(i + 2)) + p.sum() + Object.keys(p)); }
class Two { open(n) { this.a = n; this.b = n; this.c = n; this.d = n; } reset(n) { this.c = n; this.d = n; this.e = n; this.f = n; } sum() { let s = ""; for (let i = 0; i < 3; i++) s += this.a + "," + this.b + "," + this.c + "," + this.d + "," + this.e + "," + this.f + ";"; return s; } }
for (let i = 0; i < 4; i++) { const t = new Two(); if (i & 1) t.open(i); if (i & 2) t.reset(i * 10); out.push(t.sum()); t.reset(7); t.open(8); out.push(t.sum() + Object.keys(t)); }
class Base { init(n) { this.a = n; this.b = n; this.c = n; this.d = n; } sum() { let s = 0; for (let i = 0; i < 3; i++) s += this.a + this.b + this.c + this.d; return s; } }
class Heir extends Base { init(n) { super.init(n); this.x = n; this.y = n; this.z = n; this.w = n; } sum() { return super.sum() + this.x + this.y + this.z + this.w; } }
for (const make of [() => new Base(), () => new Heir(), () => Reflect.construct(Base, [], Heir), () => Object.create(Base.prototype), () => Object.create(Heir.prototype)]) {
  const one = make(); out.push(show(() => one.sum())); one.init(3); out.push(show(() => one.sum()) + Object.keys(one));
  const two = Object.assign(make(), one); out.push(show(() => two.sum()) + Object.keys(two));
  const three = make(); for (const key in one) three[key] = one[key]; out.push(show(() => three.sum()) + Object.keys(three));
  const four = make(); Base.prototype.init.call(four, 4); out.push(show(() => four.sum()) + Object.keys(four));
  const five = make(); for (const key of ["d", "c", "b", "a"]) five[key] = key.charCodeAt(0); out.push(show(() => five.sum()) + Object.keys(five));
}
// A prototype that answers for a field that is not there yet.
class Lazy { init() { this.a = 1; this.b = 2; this.c = 3; this.d = 4; } read() { let s = ""; for (let i = 0; i < 3; i++) s += this.a + "" + this.b + this.c + this.d + " "; return s; } }
const early = new Lazy(); out.push(early.read()); Lazy.prototype.c = "above"; out.push(early.read()); early.init(); out.push(early.read()); delete early.c; out.push(early.read()); Object.defineProperty(Lazy.prototype, "c", { get() { return "got"; }, configurable: true }); out.push(early.read() + new Lazy().read() + show(() => new Lazy().init()));
class Async { init() { this.a = 1; this.b = 2; this.c = 3; this.d = 4; } async run() { let s = 0; for (let i = 0; i < 3; i++) { s += this.a + this.b; await null; s += this.c + this.d; } return s; } *steps() { for (let i = 0; i < 3; i++) { yield this.a + this.d; this.a += 1; } } }
const later = new Async(); later.init(); const steps = later.steps(); steps.next(); delete later.d; out.push(String(steps.next().value) + steps.next().value); later.d = 4;
const proxied = new Proxy(new Base(), { set(target, key, value) { target[key] = value; out.push("set " + String(key)); return true; } });
proxied.init(6); out.push(proxied.sum());
(0, eval)("globalThis.touch = (o) => { delete o.c; }"); const touched = new Base(); touched.init(1); globalThis.touch(touched); out.push(show(() => touched.sum())); touched.init(2); out.push(touched.sum());
later.run().then((n) => { out.push("later " + n); for (const line of out) console.log(line); });
