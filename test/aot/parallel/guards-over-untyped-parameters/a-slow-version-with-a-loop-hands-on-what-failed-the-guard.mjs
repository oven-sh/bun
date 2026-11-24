// A function asks whether its parameter is of another class and, in a loop with that question, freezes it and stores into it. The guard at its entry fails on a parsed record, so the whole body runs in the slow version, which holds a loop and is walked.
// Under: --aot-check=Validate: a slow version that had the typed operations called on directly with what had failed the guard, and handed a callee more than its callers leave it: the compiler's own verifier stopped (TypeOutOfDate).
function tell(value) { return (typeof value === "function" ? "function" : typeof value === "object" && value !== null ? "object" : typeof value === "symbol" ? "symbol" : Object.is(value, -0) ? "-0" : String(value)) + ";"; }
function show(o) {
  if (o === null || (typeof o !== "object" && typeof o !== "function")) return String(o);
  return Reflect.ownKeys(o).filter(name => typeof name === "string" && name !== "prototype").map(name => name + ":" + tell(o[name])).join("") + " below " + tell(Object.getPrototypeOf(o)?.constructor?.name) + (Object.isFrozen(o) ? "frozen" : "");
}
class Kind { a = 1; b = 2.5; tag = "kind"; #own = 7; sum() { return this.a + this.b; } get twice() { return this.a * 2; } own() { return this.#own; } static is(o) { return #own in o; } static ownOf(o) { return o.#own; } }
class Heir extends Kind { c = 3; sum() { return super.sum() + this.c; } }
class Last extends Heir { d = 4; get twice() { return -this.a; } }
class Other { a = 10; b = 20.5; tag = "other"; sum() { return -1; } get twice() { return -2; } }
function Old() { this.a = 100; this.b = 200.5; this.tag = "old"; }
Old.prototype.sum = function () { return this.a - this.b; };
class Young extends Old { c = 300; }
class Asked { static [Symbol.hasInstance](o) { return o != null && typeof o === "object" && "a" in o; } }
function makeKind() { return class Kind { a = 1; b = 2.5; tag = "kind"; sum() { return 1000; } }; }
function without(o) { delete o.a; return o; }
function again(o) { delete o.a; o.a = 1; return o; }
function gotten(o) { return Object.defineProperty(o, "a", { get() { return 41; }, set(value) {}, enumerable: true, configurable: true }); }
function touch(o) { if (o !== null && typeof o === "object" && Object.isExtensible(o)) { o.touched = 1; if (yes) o.a = 12; } }
function same(value) { return value; }
const key = JSON.parse('"a"'), unknown = JSON.parse("9"), place = Number("1"), three = Number("3"), yes = JSON.parse("true");
const first = new Kind();
function say(name, answer) { console.log(name, answer); }
function use(o) { let answer = ""; turns: for (let turn = 0; turn < three; turn++) { if (o instanceof Other) { Object.freeze(o); try { o.a = 5; } catch (error) { { answer += error.name + tell(o.a); continue turns; } } { answer += tell(o.a); continue turns; } } answer += "not taken;"; } return answer; }
{ const made = new Kind(); let answer; try { answer = use(made); } catch (error) { answer = "threw " + error.name; } say("an-instance", answer + " | " + (made == null ? "" : tell(made.a) + tell(made.b) + tell(made.tag) + tell(made.c) + tell(made.added))); }
{ const made = new Heir(); let answer; try { answer = use(made); } catch (error) { answer = "threw " + error.name; } say("an-heir", answer + " | " + (made == null ? "" : tell(made.a) + tell(made.b) + tell(made.tag) + tell(made.c) + tell(made.added))); }
{ const made = new Other(); let answer; try { answer = use(made); } catch (error) { answer = "threw " + error.name; } say("of-another-class", answer + " | " + (made == null ? "" : tell(made.a) + tell(made.b) + tell(made.tag) + tell(made.c) + tell(made.added))); }
{ const made = (JSON.parse('{"a":1,"b":2.5,"tag":"kind"}')); let answer; try { answer = use(made); } catch (error) { answer = "threw " + error.name; } say("a-parsed-record", answer + " | " + (made == null ? "" : tell(made.a) + tell(made.b) + tell(made.tag) + tell(made.c) + tell(made.added))); }
{ const made = new Kind(); let answer; try { answer = use(made); } catch (error) { answer = "threw " + error.name; } say("an-instance-again", answer + " | " + (made == null ? "" : tell(made.a) + tell(made.b) + tell(made.tag) + tell(made.c) + tell(made.added))); }
{ const made = new Heir(); let answer; try { answer = use(made); } catch (error) { answer = "threw " + error.name; } say("an-heir-again", answer + " | " + (made == null ? "" : tell(made.a) + tell(made.b) + tell(made.tag) + tell(made.c) + tell(made.added))); }
{ const made = new Other(); let answer; try { answer = use(made); } catch (error) { answer = "threw " + error.name; } say("of-another-class-again", answer + " | " + (made == null ? "" : tell(made.a) + tell(made.b) + tell(made.tag) + tell(made.c) + tell(made.added))); }
