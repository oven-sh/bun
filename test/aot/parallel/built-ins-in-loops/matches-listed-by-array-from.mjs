// Array.from() of matchAll() with callbacks: empty matches, statics, done and partly consumed iterators, throwing callbacks, own exec, next, other constructors.
const word = /([a-z]+)(\d*)/g, empty = /x*/gu, proto = Object.getPrototypeOf("".matchAll(word)), next = proto.next;
const texts = ["alpha1 beta22 gamma", "", "xxaxx\u{1F600}x", "a1".repeat(5)];
class Sub extends Array { constructor(...all) { super(...all); this.made = all.length; } }
function Bag() { this.bag = true; }
function say(name, make) { for (const s of texts) { try { const made = make(s); console.log(name, JSON.stringify(made), made.length); } catch (error) { console.log(name, error.name, error.message); } } }
function all(when) {
  console.log(when);
  say("first", s => Array.from(s.matchAll(word), m => m[0]));
  say("index", s => Array.from(s.matchAll(word), (m, i) => m.index * 10 + i));
  say("empty", s => Array.from(s.matchAll(empty), m => m.index));
  say("static", s => Array.from(s.matchAll(word), m => { const seen = RegExp.$1; /(.)/.exec("q"); return seen + RegExp.$1; }));
  say("this", s => Array.from(s.matchAll(word), function (m) { return this.tag + m[1]; }, { tag: "t" }));
  say("throws", s => Array.from(s.matchAll(word), m => { if (m.index > 2) throw new Error("at " + m.index); return m.index; }));
  say("partly", s => { const it = s.matchAll(word); it.next(); return Array.from(it, m => m[0]); });
  say("twice", s => { const it = s.matchAll(word); return [Array.from(it, m => m[0]), Array.from(it, m => m[0])]; });
  say("without", s => Array.from(s.matchAll(word)).map(m => m[2]));
  say("sub", s => Sub.from(s.matchAll(word), m => m[1]));
  say("bag", s => Array.from.call(Bag, s.matchAll(word), m => m[1]));
  say("own next", s => { const it = s.matchAll(word); let left = 2; it.next = () => ({ done: !left--, value: ["own"] }); return Array.from(it, m => m[0]); });
  say("object", s => Array.from(Object.create(s.matchAll(word)), m => m[0]));
  say("by hand", s => { const it = s.matchAll(word), out = []; for (let step; !(step = it.next()).done;) out.push(step.value.index, Object.keys(step).join()); return out; });
  say("helpers", s => s.matchAll(word).filter(m => m.index & 1).map(m => m[0]).toArray());
}
all("as born"); all("again");
let calls = 0;
class Every extends RegExp { exec(s) { return calls++ % 4 === 3 ? null : super.exec(s); } }
class Objects extends RegExp { exec(s) { return calls++ % 3 === 2 ? null : { 0: calls % 3 ? "m" : "", index: calls, length: 1 }; } }
class Wrong extends RegExp { exec() { return 5; } }
class Throws extends RegExp { exec(s) { if (calls++ % 3 === 1) throw new Error("exec"); return super.exec(s); } }
for (const Kind of [Every, Objects, Wrong, Throws]) {
  const re = new Kind(word.source, "g");
  say(Kind.name, s => Array.from(s.matchAll(re), m => m[0] + m.index)); say(Kind.name + " helpers", s => s.matchAll(re).map(m => m[0]).toArray()); say(Kind.name + " spread", s => [...s.matchAll(re)].map(m => m[0]));
  say(Kind.name + " by hand", s => { const it = s.matchAll(re), out = []; for (let step; !(step = it.next()).done;) out.push(step.value[0]); return out; });
}
console.log(calls);
for (const value of [null, 1, {}, []]) { try { next.call(value); } catch (error) { console.log(error.name, error.message); } }
console.log(next.name, next.length, typeof next, JSON.stringify(next.call("a".matchAll(/a/g))), JSON.stringify(next.call("b".matchAll(/a/g))));
