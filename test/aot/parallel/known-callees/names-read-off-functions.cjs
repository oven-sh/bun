// Names laid on functions and read off them: before they are laid, stored again, deleted, defined, taken from above, and laid by code that nobody sees.
const out = [];
const say = (title, f) => { let v; try { v = f(); } catch (e) { v = "!" + e.constructor.name; } out.push(title + "=" + (typeof v === "function" ? "function" : typeof v === "object" ? JSON.stringify(v) : String(v))); };
const key = JSON.parse('"make"'), keys = JSON.parse('["make","other"]');
function one() { return 1; }
function two(x) { return x * 2; }
function Plain() {}
function callPlain(n) { let s = ""; for (let i = 0; i < n; i++) { try { s += Plain.make(i) + ","; } catch (e) { s += e.constructor.name + ","; } } return s; }
say("early", () => callPlain(2));
Plain.make = two;
say("laid", () => callPlain(3));
function Again() {}
Again.make = two;
const callAgain = () => Again.make(3);
say("again", callAgain);
Again.make = one;
say("stored", callAgain);
delete Again.make;
say("deleted", callAgain);
Again.make = 5;
say("number", callAgain);
function Defined() {}
Defined.make = two;
say("data", () => Defined.make(4));
Object.defineProperty(Defined, "make", { get() { out.push("get"); return one; }, configurable: true });
say("defined", () => Defined.make(4));
function Keyed() {}
Keyed.make = two;
say("by name", () => Keyed.make(5));
Keyed[key] = one;
say("by key", () => Keyed.make(5));
for (const k of keys) Keyed[k] = k;
say("by keys", () => Keyed.make);
function Assigned() {}
Assigned.make = two;
say("own", () => Assigned.make(6));
Object.assign(Assigned, { make: one, other: 2 });
say("assigned", () => Assigned.make(6) + Assigned.other);
Object.assign(Assigned, JSON.parse('{"make":"text"}'));
say("assigned text", () => Assigned.make);
function Below() {}
Below.make = two;
say("below", () => Below.make(7) + String(Below.above));
Object.setPrototypeOf(Below, { above: "above", make: one });
say("set below", () => Below.make(7) + String(Below.above));
delete Below.make;
say("found above", () => Below.make(7));
function Handed() {}
Handed.make = two;
const callHanded = () => Handed.make(8);
say("handed", callHanded);
globalThis.handed = Handed;
globalThis["handed"].make = () => "elsewhere";
say("elsewhere", callHanded);
Reflect.set(globalThis.handed, key, one);
say("reflected", callHanded);
function Frozen() {}
Frozen.make = two;
Object.freeze(Frozen);
say("frozen", () => { Frozen.make = one; return Frozen.make(9); });
const arrow = () => {};
arrow.make = two; arrow.nested = { make: one };
say("arrow", () => arrow.make(10) + arrow.nested.make());
const made = [1, 2].map(n => { const f = () => n; f.make = n === 1 ? one : two; f.only = n; return f; });
say("made", () => made.map(f => f.make(3) + f.only));
function counter() { counter.count = (counter.count || 0) + 1; return counter.count; }
say("counter", () => { let s = 0; for (let i = 0; i < 4; i++) s += counter(); return s + counter.count; });
class Holder { static make = two; static other() { return this.make(1); } }
say("class", () => Holder.make(11) + Holder.other());
Holder.make = one;
say("class again", () => Holder.make(11) + Holder.other());
function Same() {}
Same.make = two;
const alias = [Same][0];
say("same", () => Same.make(12));
alias.make = one;
say("alias", () => Same.make(12));
const proxy = new Proxy(Same, {});
proxy.make = two;
say("proxy", () => Same.make(13));
async function awaits(n) { let s = 0; for (let i = 0; i < n; i++) s += await Plain.wait(i); return s; }
Plain.wait = async function (n) { return n + 1; };
async function later() {
  say("awaits", () => "begun");
  out.push("sum=" + await awaits(3));
  Plain.wait = n => ({ then(y) { y(n * 10); } });
  out.push("sum=" + await awaits(3));
  Plain.wait = undefined;
  try { await awaits(1); } catch (e) { out.push(e.constructor.name); }
  Plain.make = one;
  say("plain last", () => callPlain(3));
}
later().then(() => console.log(out.join("\n")));
