// Functions that loops inside loops reach make records for calls whose callee only takes them apart: the copy of the callee allocates none. Callees that keep, change or pass on the record, accessors, defaults and errors beside them.
// STATISTIC: CallsInlined >= 200
const out = [];
const cache = new Map();
class Path {
  constructor(hub, parent) { this.hub = hub; this.parent = parent; this.contexts = []; this.container = null; this.listKey = null; this.key = null; this.node = null; this.removed = false; this.parentPath = null; }
  static get({ hub, parentPath, parent, container, listKey, key }) {
    if (!hub && parentPath) hub = parentPath.hub;
    if (!parent) throw new Error("To get a node path the parent needs to exist: " + key);
    const target = container[key];
    let paths = cache.get(parent);
    if (!paths) cache.set(parent, paths = new Map());
    let path = paths.get(target);
    if (!path) { path = new Path(hub, parent); if (target) paths.set(target, path); }
    setup.call(path, parentPath, container, listKey, key);
    return path;
  }
  visit(depth) { return visitNode(this.node, this, depth); }
}
function setup(parentPath, container, listKey, key) { this.parentPath = parentPath || this.parentPath; this.container = container; this.listKey = listKey; this.key = key; this.node = container[key]; }
function create(parentPath, parent, container, key, listKey) { return Path.get({ parentPath, parent, container, key: key, listKey }); }
function range({ from, to = from + 2, step = 1, label: { text = "x", size } = { size: 1 } }) { return from * 3 + to * 5 + step * 7 + text.length + size; }
function keeps(record) { if (record.a > 6) out.push(record); return record.a + record.b; }
function changes(record) { record.a += 1; record.c = record.b; return record.a * 2 + record.c + Object.keys(record).length; }
function passesOn(record) { return record.a + range({ from: record.b, label: { text: "yy", size: record.a } }); }
function counts({ a, b }) { return a + b + arguments.length + Object.keys(arguments[0]).length; }
function swaps({ a, b }) { [a, b] = [b, a]; return a * 10 + b; }
function shows(record) { return typeof record === "object" && record !== null && "a" in record ? record.a : -1; }
function lacks({ missing, a, toString: s }) { return String(missing) + a + typeof s; }
function nullish(record) { return record == null ? 0 : record.a; }
function throwsAt({ a, b }) { if (a === 4) throw new RangeError("four " + b); return a; }
function captured({ a, b }) { return () => a++ + b; }
function reads({ a }) { return a; }
let order = "";
function mark(x) { order += x; return x; }
function each(node, path, depth) {
  let total = 0;
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) for (let i = 0; i < child.length; i++) total += step(child, node, path, i, key, depth);
    else if (child && typeof child === "object") total += step(node, node, path, key, undefined, depth);
  }
  return total;
}
function step(container, parent, path, key, listKey, depth) { const made = create(path, parent, container, key, listKey); return (made.visit(depth + 1) | 0) + made.contexts.length + (made.listKey === undefined ? 1 : 2); }
function visitNode(node, path, depth) {
  if (!node || depth > 5) return 1;
  let t = range({ from: depth, to: depth + 1 }) + range({ from: depth }) + range({ step: depth, from: 1, label: { size: depth } });
  t += keeps({ a: depth, b: 2 }) + changes({ a: depth, b: 3 }) + passesOn({ b: depth, a: 1 }) + counts({ a: 1, b: depth, c: 0 }) + swaps({ b: depth, a: 2 }) + shows({ a: depth }) + shows({ b: depth });
  t += lacks({ a: depth }).length + nullish({ a: depth, b: null }) + nullish(undefined);
  try { t += throwsAt({ a: depth, b: node.type }); } catch (error) { t += error.message.length; }
  const later = captured({ a: depth, b: 1 }); t += later() + later();
  t += reads({ get a() { return depth * 2; } }) + reads({ a: 1, a: depth }) + reads({ ["a"]: depth }) + reads({ ...node, a: depth }) + reads({ __proto__: { a: depth } });
  t += mark(1) + swaps({ a: mark(2), b: mark(3) }) + mark(4);
  return t + each(node, path, depth);
}
function tree(depth, width) { return depth ? { type: "n" + depth, body: Array.from({ length: width }, (_, i) => tree(depth - 1, (width + i) % 3 + 1)), test: tree(depth - 1, 1), name: "t" } : { type: "leaf", name: "l" }; }
function run(rounds) { let t = 0; for (let round = 0; round < rounds; round++) for (let width = 1; width < 4; width++) t = (t + visitNode(tree(4, width), null, 0)) | 0; return t; }
class Walker {
  constructor() { this.total = 0; this.path = new Path(1, {}); }
  walk(rows) { for (const row of rows) this.visitRow(row); return this.total; }
  visitRow(row) { for (let i = 0; i < row.length; i++) this.enter(row[i], row, i); }
  enter(node, row, index) {
    this.add(node, index); this.change(node, index); this.keep(node, index); this.fail(node, index);
    this.make(node, row, index);
  }
  make(node, row, index) { const path = Path.get({ parentPath: this.path, parent: node, container: row, key: index }); this.total += path.contexts.length + (path.key === index ? 3 : 5) + (path.listKey === undefined ? 1 : 2); return path; }
  add(node, index) { this.total += range({ from: index, to: node.value }) + range({ from: node.value }); return passesOn({ b: index, a: node.value }); }
  change(node, index) { this.total += changes({ a: index, b: node.value }); return counts({ a: 1, b: index, c: node.value }); }
  keep(node, index) { this.total += keeps({ a: index, b: node.value }) + lacks({ a: index }).length; return captured({ a: index, b: node.value })(); }
  fail(node, index) { try { this.total += throwsAt({ a: node.value, b: index }); } catch (error) { this.total += error.message.length; } return swaps({ b: index, a: node.value }); }
}
for (let round = 0; round < 3; round++) console.log(new Walker().walk(Array.from({ length: 6 }, (_, i) => Array.from({ length: i + round }, (_, j) => ({ value: (i * j) % 7, get lazy() { return i; } })))));
const show = (work) => { try { return String(work()); } catch (error) { return error.constructor.name + " " + error.message; } };
console.log(run(3), order.length, out.length);
console.log(show(() => Path.get({ container: [1], key: 0 })), show(() => Path.get(undefined)), show(() => Path.get()), show(() => Path.get(new Proxy({ parent: {}, container: [5], key: 0 }, {})).node));
console.log(show(() => create(null, null, [], 3)), show(() => range({})), show(() => range({ from: 1, label: null })), show(() => range(Object.create({ from: 4 }))));
for (const make of [() => ({ a: 1, b: 2 }), () => Object.freeze({ a: 4, b: 5 }), () => [1], () => "ab", () => 5, () => null, () => new (class { get a() { return 9; } b = 1; })()])
  for (const f of [keeps, changes, passesOn, counts, swaps, shows, lacks, nullish, throwsAt, reads]) console.log(f.name, show(() => f(make())));
function* steps(n) { for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) yield swaps({ a: i, b: j }) + (yield range({ from: j })); }
let sum = 0; const walker = steps(4); for (let at = walker.next(); !at.done; at = walker.next(sum)) sum += at.value | 0;
console.log(sum);
(async () => { let t = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { t += swaps({ a: i, b: j }); await null; t += range({ from: i, to: await j }); } console.log(t, run(1)); })();
