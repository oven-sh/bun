// A method is one function object, however often it is read as a value and wherever the value is kept.
class Widget {
  saved: () => number = this.measure;
  other: (() => number) | undefined;
  size: number;
  constructor(size: number) {
    this.size = size;
  }
  measure(): number {
    return this === undefined ? -1 : (this as Widget).size;
  }
  twice(): number {
    return this.size * 2;
  }
  keep(): void {
    this.other = this.twice;
  }
  static make(size: number): Widget {
    return new Widget(size);
  }
}
class Gadget extends Widget {
  override twice(): number {
    return this.size * 3;
  }
}

const lines: string[] = [];
const say = (label: string, ...values: unknown[]) => lines.push(label + ": " + values.map(String).join(" "));

function localsOnly(a: Widget, b: Widget): boolean[] {
  const f = a.measure;
  const g = b.measure;
  const h = a.twice;
  return [f === g, Object.is(f, g), f === h, f == g, f !== g];
}

function inLiterals(a: Widget, b: Widget): boolean[] {
  const first = { f: a.measure, n: 1 };
  const second = { f: b.measure, n: 2 };
  const list = [a.measure, b.measure, a.twice];
  return [first.f === second.f, first.f === a.measure, list[0] === list[1], list[0] === list[2], list.indexOf(b.measure) === 0, list.includes(a.twice)];
}

function inCollections(a: Widget, b: Widget): number[] {
  const set = new Set([a.measure, b.measure, a.twice, b.twice]);
  const map = new Map<unknown, number>();
  map.set(a.measure, 1);
  map.set(b.measure, 2);
  const weak = new WeakMap<object, number>();
  weak.set(a.twice, 7);
  return [set.size, map.size, map.get(Widget.prototype.measure) ?? -1, weak.get(b.twice) ?? -1];
}

function withProperties(a: Widget, b: Widget): unknown[] {
  const f = a.measure as (() => number) & { tag?: number };
  f.tag = (f.tag ?? 0) + 1;
  const g = b.measure as (() => number) & { tag?: number };
  return [g.tag, (Widget.prototype.measure as { tag?: number }).tag, Object.keys(g).join()];
}

function throughCalls(a: Widget, b: Widget): boolean[] {
  const same = (x: unknown, y: unknown) => x === y;
  const give = (w: Widget) => w.measure;
  return [same(a.measure, b.measure), give(a) === give(b), same(give(a), Widget.prototype.measure), same(a.twice, b.twice)];
}

function inClosures(a: Widget, b: Widget): boolean {
  const f = a.measure;
  const later = () => f === b.measure;
  return later();
}

const a = new Widget(1);
const b = Widget.make(2);
const c = new Gadget(3);
for (let round = 0; round < 3; round++) {
  say("fields of the object itself", a.saved === b.saved, a.saved === Widget.prototype.measure, a.saved === a.measure, c.saved === a.saved);
  a.keep();
  b.keep();
  c.keep();
  say("fields stored by a method", a.other === b.other, a.other === Widget.prototype.twice, c.other === a.other, c.other === Gadget.prototype.twice);
  say("locals", ...localsOnly(a, b));
  say("locals, an heir", ...localsOnly(a, c));
  say("literals", ...inLiterals(a, b));
  say("collections", ...inCollections(a, b));
  say("collections, an heir", ...inCollections(a, c));
  say("properties", ...withProperties(a, b));
  say("calls", ...throughCalls(a, b));
  say("calls, an heir", ...throughCalls(a, c));
  say("closures", inClosures(a, b));
  say("called", a.saved.call(b), b.saved.call(a), a.measure.call(c), a.other!.call(c), c.other!.call(a));
}

// The method is replaced: what was read before stays what it was.
const before = a.measure;
Widget.prototype.measure = function (this: Widget) {
  return 100 + this.size;
};
say("replaced", before === a.measure, a.measure === b.measure, a.saved === before, new Widget(4).saved === a.measure, new Widget(4).saved.call(a), before.call(a));

console.log(lines.join("\n"));
