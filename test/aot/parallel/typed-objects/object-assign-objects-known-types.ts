// Object.assign where the compiler knows the types of both sides: the fields are copied in line when the source has one of the key orders that its type foresees. Everything that the copy in line does not serve must come out the same: another key order, an extra property on the source, numbers kept in boxes, a frozen target, a field that is not there yet, an heir of the target's class, a setter.
const lines: string[] = [];
function say(label: string, work: () => unknown) {
  let text: string;
  try {
    text = JSON.stringify(work()) ?? "undefined";
  } catch (error) {
    text = "throws " + (error as Error).constructor.name;
  }
  lines.push(label + ": " + text);
}
const own = (object: object) => Reflect.ownKeys(object).map(String).join();

class Point {
  x = 0;
  y = 0;
  label = "origin";
  visible = true;
  weight = 0.5;
  tag: string | null = null;
  next: Point | undefined = undefined;
}
class Point3 extends Point {
  z = 0;
}
type Patch = { x: number; y: number; label: string; visible: boolean };

function patch(point: Point, values: Patch) {
  return Object.assign(point, values);
}
function move(point: Point, values: { x: number; y: number }) {
  Object.assign(point, values);
  return point.x + point.y;
}
function weigh(point: Point, values: { weight: number }) {
  Object.assign(point, values);
  return point.weight;
}
function link(point: Point, values: { next: Point | undefined; tag: string | null }) {
  Object.assign(point, values);
  return [point.next === undefined ? "none" : point.next.label, point.tag];
}
function extend(point: Point, values: { color: string; size: number; x: number }) {
  const extended = Object.assign(point, values);
  return [own(extended), extended.color, extended.size, extended.x];
}
function both(point: Point, first: { x: number }, second: { y: number; x: number }) {
  Object.assign(point, first, second);
  return [point.x, point.y];
}

for (let turn = 0; turn < 4; turn++) {
  say("four fields " + turn, () => {
    const p = patch(new Point(), { x: turn, y: -turn, label: "p" + turn, visible: turn % 2 === 0 });
    return [own(p), p.x, p.y, p.label, p.visible, p.weight];
  });
  say("the other key order " + turn, () => {
    const p = patch(new Point(), { visible: false, label: "reversed", y: turn, x: 2 * turn });
    return [own(p), p.x, p.y, p.label, p.visible];
  });
  say("an heir of the class " + turn, () => {
    const p = new Point3();
    patch(p, { x: turn, y: 1, label: "heir", visible: false });
    return [own(p), p.x, p.label, p.z];
  });
  say("names beyond the class " + turn, () => extend(new Point(), { color: "red", size: turn + 0.5, x: turn }));
  say("names beyond the class, twice " + turn, () => {
    const p = new Point();
    extend(p, { color: "red", size: 1, x: 1 });
    return extend(p, { color: "blue", size: turn, x: 2 });
  });
  say("two sources " + turn, () => both(new Point(), { x: turn }, { y: turn + 1, x: turn + 2 }));
}
say("a source with one property more than its type says", () => {
  const wide = { x: 1, y: 2, label: "wide", visible: false, surplus: "kept" };
  const p: any = patch(new Point(), wide);
  return [own(p), p.surplus, p.x];
});
say("a source that got a property later, lost one, has an accessor", () => {
  const seen: unknown[] = [];
  const later: Patch = { x: 1, y: 2, label: "later", visible: true };
  (later as any).added = 1;
  seen.push(own(patch(new Point(), later)));
  const fewer: { x: number; y?: number } = { x: 5, y: 6 };
  delete fewer.y;
  seen.push(move(new Point(), fewer as { x: number; y: number }));
  let reads = 0;
  const computed = { x: 1, get y() { return ++reads; } };
  seen.push(move(new Point(), computed), move(new Point(), computed), reads);
  return seen;
});
say("numbers of every size", () => {
  const seen: unknown[] = [];
  const p = new Point();
  for (const n of [1, 1073741823, 1073741824, -1073741824, -1073741825, 4294967296, 0.25, -0, NaN, 2]) {
    seen.push(String(move(p, { x: n, y: 0 })), Object.is(p.x, -0));
    seen.push(String(weigh(p, { weight: n })));
  }
  return seen;
});
say("cells, undefined and null", () => {
  const seen: unknown[] = [];
  const p = new Point();
  const other = new Point();
  other.label = "other";
  seen.push(link(p, { next: other, tag: "tagged" }), link(p, { next: undefined, tag: null }), link(p, { next: p, tag: "" }));
  return seen;
});
say("a frozen, a sealed target", () => {
  const seen: unknown[] = [];
  for (const close of [(p: Point) => Object.freeze(p), (p: Point) => Object.seal(p), (p: Point) => Object.preventExtensions(p)]) {
    for (const work of [(p: Point) => move(p, { x: 1, y: 2 }), (p: Point) => extend(p, { color: "c", size: 1, x: 3 })]) {
      const p = close(new Point());
      try {
        seen.push(work(p));
      } catch (error) {
        seen.push((error as Error).constructor.name, p.x, own(p));
      }
    }
  }
  return seen;
});
class Late {
  first = 1;
  second?: number;
  third?: string;
}
say("fields that are not there yet", () => {
  const seen: unknown[] = [];
  const fill = (late: Late, values: { third: string; second: number }) => Object.assign(late, values);
  for (let turn = 0; turn < 3; turn++) {
    const late = fill(new Late(), { third: "t" + turn, second: turn });
    seen.push([own(late), late.second, late.third]);
    fill(late, { third: "again", second: -turn });
    seen.push([own(late), late.second, late.third]);
  }
  return seen;
});
class Watched {
  plain = 1;
  log = "";
  set seen(value: number) {
    this.log += value + ":" + this.plain + ";";
  }
  get seen() {
    return -1;
  }
}
say("a setter of the class, between two fields", () => {
  const fill = (watched: Watched, values: { seen: number; plain: number }) => Object.assign(watched, values);
  const after = (watched: Watched, values: { plain: number; seen: number }) => Object.assign(watched, values);
  return [fill(new Watched(), { seen: 5, plain: 2 }).log, after(new Watched(), { plain: 3, seen: 6 }).log];
});
say("the target is the source; the target is null", () => {
  const p = new Point();
  p.x = 4;
  const same = Object.assign(p, p);
  let thrown = "";
  try {
    patch(null as unknown as Point, { x: 1, y: 1, label: "", visible: true });
  } catch (error) {
    thrown = (error as Error).constructor.name;
  }
  return [same === p, p.x, thrown];
});
say("many objects, so that collections fall between the calls", () => {
  let sum = 0;
  let previous: Point | undefined = undefined;
  for (let i = 0; i < 30000; i++) {
    const p = patch(new Point(), { x: i, y: i & 7, label: "l" + (i & 15), visible: (i & 1) === 0 });
    link(p, { next: i & 3 ? previous : undefined, tag: i & 1 ? "t" + i : null });
    const extended = Object.assign(p, { color: "c" + (i & 3), size: i / 2, x: i + 1 });
    sum += extended.x + p.y + p.label.length + extended.color.length + extended.size + (p.next ? p.next.x : 0) + (p.tag ? p.tag.length : 0);
    previous = p;
  }
  return sum;
});

console.log(lines.join("\n"));
