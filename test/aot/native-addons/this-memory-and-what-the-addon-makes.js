// The other ways in: `this`, the exports object as it was before the load, a class of the addon that classes of the program extend, memory behind views, and what the addon makes, throws and resolves.
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  sum() {
    return this.x + this.y;
  }
}
const seed = new Point(1, 2);
const loaded = { exports: { seed } };
process.dlopen(loaded, process.env.ADDON);
const attack = loaded.exports;
let at = 0;
function say(label, value) {
  console.log(String(++at).padStart(3) + " " + label + ": " + JSON.stringify(value));
}
function row(label, f) {
  let said;
  try {
    said = f();
  } catch (error) {
    said = "threw " + error.constructor.name + ": " + error.message + (error.code ? " " + error.code : "");
  }
  say(label, said);
}
function total(point) {
  let sum = 0;
  for (let round = 0; round < 200; round++) sum += point.x + point.y + point.sum();
  return sum;
}

row("what the exports object held", () => [seed.x, total(seed), attack.seed === seed]);
row("this of a call", () => { const p = new Point(1, 2); return [attack.storeIntoThis.call(p, "x", 10) === p, total(p)]; });
row("this of a method", () => { const p = new Point(1, 2); p.touch = attack.storeIntoThis; p.touch("y", 20); return [total(p), Object.keys(p).join()]; });
row("this of a method on the prototype", () => { class Own extends Point {} Own.prototype.touch = attack.storeIntoThis; const p = new Own(1, 2); let sum = 0; for (let round = 0; round < 50; round++) { sum += p.x; p.touch("x", round); sum += p.x; } return sum; });
row("this of a bound function", () => { const p = new Point(1, 2); const touch = attack.storeIntoThis.bind(p); touch("x", 30); return total(p); });
row("this of a callback of a built-in", () => { const p = new Point(1, 2); ["x", "y"].forEach(function (key, index) { attack.storeIntoThis.call(this, key, index + 40); }, p); return total(p); });

class Heir extends attack.Base {
  constructor(value) {
    super(value);
    this.own = 2;
  }
  both() {
    return this.fromBase + this.own + this.base();
  }
}
class Lower extends Heir {
  extra = 5;
  both() {
    return super.both() + this.extra;
  }
}
function useHeir(heir) {
  let sum = 0;
  for (let round = 0; round < 200; round++) sum += heir.both() + heir.own;
  return sum;
}
row("a class below a class of the addon", () => { const h = new Heir(1); return [useHeir(h), JSON.stringify(h), h instanceof attack.Base]; });
row("two levels below", () => { const l = new Lower(1); return [useHeir(l), JSON.stringify(l)]; });
row("the addon kept what it constructed", () => { const h = new Heir(1); return [attack.storeIntoLastConstructed("own", 100), attack.storeIntoLastConstructed("fromBase", 200), useHeir(h)]; });
row("the addon changes it inside the loop", () => { const l = new Lower(1); let sum = 0; for (let round = 0; round < 50; round++) { sum += l.both(); attack.storeIntoLastConstructed("extra", round); sum += l.extra; } return sum; });
row("constructed by the addon", () => { const l = attack.construct(Lower, 3); return [useHeir(l), l instanceof Lower]; });
row("its prototype changed", () => { const h = new Heir(1); attack.store(attack.Base.prototype, "base", function () { return 1000; }); return useHeir(h); });

function sumOf(view) {
  let sum = 0;
  for (let i = 0; i < view.length; i++) sum += view[i];
  return sum;
}
for (const View of [Uint8Array, Int32Array, Float64Array]) {
  row(View.name + " poked", () => { const v = new View(8).fill(1); return [attack.poke(v, 3, 50), sumOf(v), v[3]]; });
  row(View.name + " poked inside the loop", () => { const v = new View(8).fill(1); let sum = 0; for (let i = 0; i < v.length; i++) { sum += v[i]; if (i < 7) attack.poke(v, i + 1, 10 + i); } return sum; });
  row(View.name + " poked between two reads", () => { const v = new View(4).fill(1); let sum = 0; for (let round = 0; round < 20; round++) { sum += v[2]; attack.poke(v, 2, round); sum += v[2]; } return sum; });
  row(View.name + " detached", () => { const v = new View(8).fill(1); return [attack.detach(v.buffer), v.length, sumOf(v), v[0] === undefined, v.byteLength]; });
  row(View.name + " detached inside the loop", () => { const v = new View(8).fill(1); let seen = ""; for (let i = 0; i < v.length; i++) { seen += v[i] + ","; if (i === 2) attack.detach(v.buffer); } return seen; });
  row(View.name + " detached inside a loop over a fixed count", () => { const v = new View(8).fill(1); let seen = ""; for (let i = 0; i < 6; i++) { seen += v[i] + ","; if (i === 2) attack.detach(v.buffer); } return seen; });
  row(View.name + " detached, then stored to", () => { const v = new View(8).fill(1); attack.detach(v.buffer); for (let i = 0; i < 8; i++) v[i] = 5; return [v.length, v[1] === undefined]; });
}
row("a buffer poked", () => { const b = Buffer.alloc(4, 1); return [attack.poke(b, 1, 65), b.toString("latin1").charCodeAt(1), sumOf(b)]; });

function readRecord(record) {
  let sum = 0;
  for (let round = 0; round < 200; round++) sum += record.x + record.y + record.list.length + record.list[0];
  return sum;
}
row("a record made by the addon", () => { const p = new Point(1, 2); const r = attack.makeRecord(p); return [readRecord(r), r.handed === p, r.list[1] === p, JSON.stringify(r)]; });
row("records of the addon and of the program at one site", () => [readRecord(attack.makeRecord(0)), readRecord({ x: 1, y: 2.5, list: [1, 0], handed: 0 }), readRecord({ list: [3], y: 1, x: 2 })]);
row("an error thrown by the addon", () => attack.throws("from the addon"));
row("a value thrown by the addon", () => { const p = new Point(1, 2); try { attack.throwsValue(p); } catch (thrown) { return [thrown === p, total(thrown)]; } return "nothing"; });
row("thrown through compiled frames", () => { const through = n => (n ? through(n - 1) + 1 : attack.throws("deep")); try { return through(30); } finally { at += 0; } });
{
  const p = new Point(1, 2);
  const promise = attack.resolvesLater(p);
  say("a promise of the addon", [promise instanceof Promise, total(p)]);
  const resolved = await promise;
  say("resolved with what was handed in", [resolved === p, total(resolved)]);
  const thenable = { then(resolve) { resolve("adopted"); } };
  say("resolved with a thenable", await attack.resolvesLater(thenable));
  say("several at once", await Promise.all([attack.resolvesLater(1), attack.resolvesLater("two"), attack.resolvesLater([3])]));
}
