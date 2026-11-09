// The constructor of the parent calls a method of the class below, which touches a private name whose initializer has not run: the slot is empty, and the access throws.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
class Base { seen; constructor() { this.seen = this.look(); } look() { return "base"; } }
class Reading extends Base { #x = 7; look() { try { return "read " + this.#x; } catch (e) { return "read throws " + (e instanceof TypeError); } } later() { return this.#x; } }
class Storing extends Base { #x = 7; look() { try { this.#x = 9; return "stored"; } catch (e) { return "store throws " + (e instanceof TypeError); } } later() { return this.#x; } }
class Asking extends Base { #x = 7; look() { return "has " + (#x in this); } later() { return #x in this; } }
class Calling extends Base { #m() { return 1; } get #g() { return 2; } look() { try { return "call " + this.#m() + this.#g; } catch (e) { return "call throws " + (e instanceof TypeError); } } later() { return this.#m() + this.#g; } }
class InOrder { #a = this.peek(); #b = 2; peek() { try { return "b is " + this.#b; } catch (e) { return "b throws " + (e instanceof TypeError); } } a() { return this.#a; } }
class StoresEarly { #a = this.poke(); #b = 2; poke() { try { this.#b = 5; return "stored"; } catch (e) { return "store throws " + (e instanceof TypeError); } } a() { return this.#a + this.#b; } }
for (let round = 0;round < 3; round++) { const r = new Reading; report(r.seen); report(r.later()); report(r.look()); const s = new Storing; report(s.seen); report(s.later()); report(s.look()); report(s.later()); const q = new Asking; report(q.seen); report(q.later()); report(q.look()); const c = new Calling; report(c.seen); report(c.later()); report(c.look()); report(new InOrder().a()); report(new InOrder().peek()); report(new StoresEarly().a()); report(new StoresEarly().poke()); }
report("end");
