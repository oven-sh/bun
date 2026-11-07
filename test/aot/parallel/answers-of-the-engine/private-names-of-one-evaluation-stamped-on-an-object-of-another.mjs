// A parent that returns what it is given lets one evaluation of a class define its names on an object that another evaluation of the same class made: the slots are taken, and each evaluation finds its own.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function attempt(f) { try { report(f()); } catch (e) { report(e instanceof TypeError ? "TypeError" : "other"); } }
class Base { kept = 1; constructor(given) { if (given) return given; } }
function make(tag) { return class S extends Base { #x = tag; #y = tag * 2; #m() { return tag * 3; } static get(o) { return o.#x + o.#y; } static set(o, v) { o.#x = v; } static has(o) { return #x in o; } static call(o) { return o.#m(); } }; }
function makeOfFieldsAlone(tag) { return class F extends Base { #x = tag; static get(o) { return o.#x; } static has(o) { return #x in o; } }; }
let stampsNext = null;
function stampIfAsked(o) { const stamps = stampsNext; stampsNext = null; if (stamps) new stamps(o); return 0; }
function makeStampedEarly(tag) { return class E extends Base { #a = tag + stampIfAsked(this); #b = tag + 1; static get(o) { return o.#a * 100 + o.#b; } static has(o) { return #a in o; } }; }
const E1 = makeStampedEarly(1);
const E2 = makeStampedEarly(2);
const S1 = make(1);
const S2 = make(10);
const F1 = makeOfFieldsAlone(100);
const F2 = makeOfFieldsAlone(200);
for (let round = 0;round < 3; round++) { const own1 = new S1; const own2 = new S2; attempt(() => S1.get(own1)); attempt(() => S2.get(own1)); attempt(() => S1.has(own1)); attempt(() => S2.has(own1)); attempt(() => S2.call(own1)); attempt(() => new S2(own1) === own1); attempt(() => S1.get(own1)); attempt(() => S2.get(own1)); attempt(() => S1.has(own1)); attempt(() => S2.has(own1)); attempt(() => S1.call(own1)); attempt(() => S2.call(own1)); attempt(() => new S2(own1)); attempt(() => new S1(own1)); attempt(() => S2.set(own1, 50 + round)); attempt(() => S1.get(own1)); attempt(() => S2.get(own1)); attempt(() => S1.set(own1, 7 + round)); attempt(() => S1.get(own1)); attempt(() => S2.get(own1)); attempt(() => S1.has(own2)); attempt(() => new S1(own2) === own2); attempt(() => S1.has(own2)); attempt(() => S1.get(own2)); attempt(() => S2.get(own2)); const plain = { kept: 0 }; attempt(() => S1.has(plain)); attempt(() => new S1(plain) === plain); attempt(() => new S2(plain) === plain); attempt(() => S1.get(plain)); attempt(() => S2.get(plain)); attempt(() => new S1(plain)); const f1 = new F1; attempt(() => F1.get(f1)); attempt(() => F2.has(f1)); attempt(() => F2.get(f1)); attempt(() => new F2(f1) === f1); attempt(() => F1.get(f1)); attempt(() => F2.get(f1)); attempt(() => new F2(f1)); attempt(() => new F1(f1)); attempt(() => new F1(own1) === own1); attempt(() => F1.get(own1)); attempt(() => S1.get(own1)); attempt(() => F2.has(own1)); stampsNext = E2; let early = null; attempt(() => { early = new E1; return E1.get(early); }); attempt(() => E2.get(early)); attempt(() => E1.has(early)); attempt(() => E2.has(early)); attempt(() => new E2(early)); attempt(() => E1.get(new E1)); }
report("end");
