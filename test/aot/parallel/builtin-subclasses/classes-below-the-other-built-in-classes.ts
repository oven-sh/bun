// Classes below Date, RegExp, Promise, typed arrays, ArrayBuffer, DataView, EventTarget, URL, Boolean, Number, String and Function: declared in parameters, results, fields, lists, casts and tail calls,
// and handed plain instances of the built-in class, objects of the class beside, look-alikes and other things where the class is declared.
class Stamp extends Date { tag(n: number): number { return n + 1; } get year(): number { return this.getUTCFullYear(); } }
class Other extends Date { tag(n: number): number { return n + 100; } }
class Rule extends RegExp { tag(n: number): number { return n + 2; } }
class Later<T> extends Promise<T> { tag(n: number): number { return n + 3; } }
class Bytes extends Uint8Array { tag(n: number): number { return n + 4; } sum(): number { let t = 0; for (let i = 0; i < this.length; i++) t += this[i]!; return t; } }
class Room extends ArrayBuffer { tag(n: number): number { return n + 5; } }
class View extends (DataView as new (buffer: ArrayBuffer) => DataView<ArrayBuffer>) { tag(n: number): number { return n + 6; } }
class Hub extends EventTarget { tag(n: number): number { return n + 7; } }
class Link extends URL { tag(n: number): number { return n + 8; } }
class Flag extends Boolean { tag(n: number): number { return n + 9; } }
class Count extends Number { tag(n: number): number { return n + 10; } }
class Text extends String { tag(n: number): number { return n + 11; } }
class Holder { stamp: Stamp; list: Stamp[]; bytes: Bytes | null = null; constructor(stamp: Stamp) { this.stamp = stamp; this.list = [stamp]; } }
function tagOf(s: Stamp, n: number): number { return s.tag(n); }
function timeOf(s: Stamp): number { return s.getTime() + s.year; }
function same(s: Stamp): Stamp { return s; }
function tail(s: Stamp): Stamp { return same(s); }
function filled(b: Bytes): Bytes { return b.fill(b[1]!, 0, 1) as Bytes; }
function first(list: Stamp[]): Stamp { return list[0]!; }
function hold(h: Holder, s: Stamp): number { h.stamp = s; h.list.push(s); return h.list.length + tagOf(h.stamp, 1); }
function either(x: Stamp | Rule | Bytes, n: number): number { return x.tag(n); }
function isStamp(x: unknown): x is Stamp { return x instanceof Stamp; }
function attempt(label: string, run: () => unknown) { try { console.log(label, String(run())); } catch (e) { console.log(label, "threw", (e as Error).constructor.name); } }
for (let round = 0; round < 4; round++) {
  const stamps: [string, any][] = [["stamp", new Stamp(86400000)], ["other", new Other(5)], ["date", new Date(7)], ["date with the prototype", Object.setPrototypeOf(new Date(9), Stamp.prototype)],
    ["made by Date for Stamp", Reflect.construct(Date, [11], Stamp)], ["stamp without its prototype", Object.setPrototypeOf(new Stamp(13), Date.prototype)], ["look-alike", { tag: (n: number) => -n, getTime: () => 1, year: 2 }],
    ["below the prototype", Object.create(Stamp.prototype)], ["null", null], ["number", 4]];
  for (const [label, thing] of stamps) {
    attempt(label + " tag", () => tagOf(thing, round)); attempt(label + " time", () => timeOf(thing)); attempt(label + " tail", () => tail(thing) === thing);
    attempt(label + " held", () => hold(new Holder(thing), thing)); attempt(label + " first", () => first([thing]) === thing); attempt(label + " either", () => either(thing, 1)); attempt(label + " is", () => isStamp(thing));
  }
  const bytes = new Bytes([1, 2, 3]);
  attempt("bytes", () => [filled(bytes).join(), filled(bytes) instanceof Bytes, bytes.sum(), bytes.tag(1), bytes.subarray(1) instanceof Bytes, bytes.map(x => x * 2).constructor.name, either(bytes, 2)].join(" "));
  attempt("plain bytes", () => [filled(new Uint8Array([4, 5]) as any).join(), (Bytes.prototype.sum as any).call(new Uint8Array([4, 5]))].join(" "));
  attempt("rule", () => { const r = new Rule("a+", "g"); return [r.tag(1), r.test("caat"), r.lastIndex, "caat".replace(r, "-"), r.exec("xaa")?.[0], either(r, 3), r instanceof Rule, r.flags].join(" "); });
  attempt("others", () => [new Room(8).tag(1), new Room(8).byteLength, new Room(8).slice(2) instanceof Room, new View(new ArrayBuffer(4)).tag(1), new View(new ArrayBuffer(4)).getInt8(0), new Hub().tag(1), new Link("http://a/b?c").tag(1),
    new Link("http://a/b?c").pathname, new Flag(false).tag(1), new Flag(false).valueOf(), new Count(4).tag(1), new Count(4).toFixed(1), +new Count(4) + 1, new Text("ab").tag(1), new Text("ab").length, new Text("ab") + "c", new Text("ab").toUpperCase()].join(" "));
  const later = new Later<number>(resolve => resolve(round));
  later.then(v => v + 1).then(v => console.log("later", v, later.tag(1), later.then(() => 0) instanceof Later, Later.resolve(1) instanceof Later));
  const hub = new Hub(); let heard = 0; hub.addEventListener("x", () => { heard++; }); hub.dispatchEvent(new Event("x")); console.log("hub", heard);
}
