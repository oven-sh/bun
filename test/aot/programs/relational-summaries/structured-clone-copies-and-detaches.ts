// structuredClone keeps nothing of its operand, and still it is no reader: it runs the operand's getters, answers a graph that is new in every part but shaped like the old one, throws on what it cannot copy, and with `transfer` it empties the operand.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  if (depth > 0) return churn(depth - 1) + pair.left;
  Bun.gc(true);
  return pair.right;
}
interface Graph {
  tag: string;
  list: number[];
  child: { tag: string; parent?: Graph };
  again?: { tag: string };
}
function cloneOf<T>(x: T): T {
  return structuredClone(x);
}
function graph(i: number): Graph {
  const g: Graph = { tag: "graph " + i, list: [i, i + 1], child: { tag: "child " + i } };
  g.child.parent = g;
  g.again = g.child;
  return g;
}
const keptClones: Graph[] = [];
let line = "";
for (let i = 0; i < 200; i++) {
  const original = graph(i);
  const copy = cloneOf(original);
  copy.list.push(-1);
  copy.child.tag += " (copy)";
  line = [copy === original, copy.child === original.child, copy.list === original.list, copy.child.parent === copy, copy.again === copy.child, original.list.length, copy.list.length, original.child.tag, copy.again!.tag].join();
  if (i % 90 === 89) keptClones.push(cloneOf(graph(i)));
}
console.log(line, churn(60), keptClones.map(g => g.tag + ">" + g.child.parent!.again!.tag).join(" | "));

// Getters run, with the operand as `this`; the copy holds their answers as plain values; the class is gone.
const kept: object[] = [];
class Spy {
  plain = 1;
  get computed(): number {
    kept.push(this);
    return 2;
  }
}
const withOwnGetter = (tag: string) => ({
  tag,
  get computed() {
    kept.push(this);
    return 3;
  },
});
const spyCopy = cloneOf(new Spy());
const literalCopy = cloneOf(withOwnGetter("a literal with a getter"));
console.log(JSON.stringify(spyCopy), spyCopy instanceof Spy, JSON.stringify(literalCopy), Object.getOwnPropertyDescriptor(literalCopy, "computed")!.get, kept.length, (kept[0] as { tag: string }).tag);

// What cannot be copied.
for (const bad of [() => 1, Symbol("s"), { f() {} }, new WeakMap(), new Proxy({}, {}), { deep: [{ deeper: () => 1 }] }]) {
  try {
    console.log(typeof cloneOf(bad));
  } catch (error) {
    console.log((error as Error).name);
  }
}

// Kinds that survive, and those that change.
const kinds = cloneOf({ date: new Date(5), re: /x/gi, map: new Map([[{ k: 1 }, new Set([1])]]), big: 5n, nan: NaN, zero: -0, hole: [1, , 3], bytes: new Uint8Array([1, 2]), error: new RangeError("r"), boxed: new String("s"), undef: undefined, nul: null });
console.log(kinds.date.getTime(), kinds.re.flags, kinds.re.lastIndex, [...kinds.map.keys()][0].k, [...kinds.map.values()][0].has(1), kinds.big, kinds.nan, Object.is(kinds.zero, -0), 1 in kinds.hole, kinds.bytes.join(), kinds.error instanceof RangeError, kinds.error.message, typeof kinds.boxed, "undef" in kinds, kinds.nul);

// Transfer: the operand is emptied.
function moveOut(buffer: ArrayBuffer): ArrayBuffer {
  return structuredClone(buffer, { transfer: [buffer] });
}
function lengthAfterMoving(i: number): string {
  const buffer = new ArrayBuffer(8);
  const view = new Uint8Array(buffer);
  view[0] = i;
  const before = buffer.byteLength + "/" + view.length;
  const moved = moveOut(buffer);
  return [before, buffer.byteLength, view.length, view[0], buffer.detached, moved.byteLength, new Uint8Array(moved)[0]].join();
}
for (let i = 0; i < 100; i++) line = lengthAfterMoving(i);
console.log(line);
function transferMethod(buffer: ArrayBuffer): ArrayBuffer {
  return buffer.transfer(4);
}
const source = new ArrayBuffer(8);
const shorter = transferMethod(source);
console.log(source.byteLength, source.detached, shorter.byteLength);

// Views of one buffer stay views of one buffer.
const shared = new ArrayBuffer(4);
const views = cloneOf({ a: new Uint8Array(shared), b: new Uint16Array(shared) });
views.a[0] = 1;
console.log(views.a.buffer === views.b.buffer, views.b[0], (views.a.buffer as ArrayBuffer) === shared, new Uint8Array(shared)[0]);
