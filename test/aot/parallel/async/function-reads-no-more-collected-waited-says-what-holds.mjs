// function-reads-no-more-collected-waited.mjs again. Where an object is kept it goes on to print what holds it.
import { generateHeapSnapshotForDebugging } from "bun:jsc";
// For an object that is kept: the chains of cells from it to a root, or to a cell that no cell holds, by a snapshot of the heap.
class MarkOfTheProbe {
  constructor(held) {
    this.held = held;
  }
}
function holders(object) {
  globalThis.markOfTheProbe = new MarkOfTheProbe(object);
  const taken = generateHeapSnapshotForDebugging();
  const { nodes, nodeClassNames, edges, edgeTypes, edgeNames, roots, labels } = typeof taken === "string" ? JSON.parse(taken) : taken;
  globalThis.markOfTheProbe = undefined;
  const classOf = new Map();
  for (let i = 0; i < nodes.length; i += 7) classOf.set(nodes[i], nodeClassNames[nodes[i + 2]]);
  const incoming = new Map();
  let target;
  for (let e = 0; e < edges.length; e += 4) {
    const from = classOf.get(edges[e]);
    if (from === "MarkOfTheProbe" && classOf.get(edges[e + 1]) === "Object") target = edges[e + 1];
    if (from === "MarkOfTheProbe" || from === "WeakRef") continue;
    let list = incoming.get(edges[e + 1]);
    if (!list) incoming.set(edges[e + 1], (list = []));
    list.push(e);
  }
  if (target === undefined) return ["the snapshot does not show the object"];
  const reasons = new Map();
  for (let r = 0; r < roots.length; r += 3) reasons.set(roots[r], labels[roots[r + 2]] || labels[roots[r + 1]] || "a root");
  const nameOf = e => {
    const type = edgeTypes[edges[e + 2]];
    return type === "Property" || type === "Variable" ? type + " " + edgeNames[edges[e + 3]] : type === "Index" ? "Index " + edges[e + 3] : type;
  };
  const ends = [];
  const levels = [];
  const seen = new Set([target]);
  let level = [[target, classOf.get(target)]];
  for (let depth = 0; depth < 40 && level.length && ends.length < 3; depth++) {
    const next = [];
    for (const [id, chain] of level) {
      const list = incoming.get(id) ?? [];
      if (reasons.has(id)) ends.push(chain + " < root: " + reasons.get(id));
      else if (!list.length) ends.push(chain + " < no cell holds it");
      for (const e of list) {
        if (seen.has(edges[e])) continue;
        seen.add(edges[e]);
        next.push([edges[e], chain + " < " + nameOf(e) + " of " + (classOf.get(edges[e]) ?? "the root node")]);
      }
    }
    level = next;
    if (depth < 5 && level.length) levels.push(depth + 1 + " away: " + [...new Set(level.map(([id]) => classOf.get(id) ?? "the root node"))].slice(0, 6).join(", "));
  }
  return [...levels, ...ends.slice(0, 3).map(chain => (chain.length > 400 ? chain.slice(0, 200) + " .. " + chain.slice(-190) : chain))];
}
function collectFromDeeper(depth) {
  if (depth > 0) return collectFromDeeper(depth - 1) + 1;
  collect();
  return 0;
}
// Says nothing where the object was collected.
function probe() {
  sink += collectFromDeeper(40) - 40;
  console.log("  collected again from forty calls deeper:", last.deref() !== undefined ? "kept" : "collected");
  const object = last.deref();
  if (object !== undefined) for (const line of holders(object)) console.log("  " + line);
}
let last;
let sink = 0;
function make(n) {
  const made = { n };
  last = new WeakRef(made);
  return made;
}
function collect() {
  for (let round = 0; round < 4; round++) Bun.gc(true);
}
function report(label) {
  const kept = last.deref() !== undefined;
  console.log(label + ":", kept ? "kept" : "collected");
  if (kept) probe();
}
const timer = () => new Promise(resolve => setTimeout(resolve, 1));

async function waitsOnce(label) {
  await timer();
  collect();
  report(label + ", waits once");
  return 1;
}
async function waitsBehindSettledValues(label) {
  const a = await 1;
  const b = await a;
  await timer();
  collect();
  report(label + ", waits behind settled values");
  return a + b;
}
async function waitsOnOnePath(label) {
  let kept = 0;
  if (label.length > 1000) kept = await timer();
  else await timer();
  collect();
  report(label + ", waits on one of two paths");
  return kept;
}
async function keepsMoreLater(label) {
  await timer();
  collect();
  report(label + ", keeps more over later waits");
  const a = [label.length];
  const b = [a.length];
  await timer();
  const c = [a[0] + b[0]];
  await timer();
  return a[0] + b[0] + c[0];
}
function* yields(label) {
  yield 1;
  collect();
  report(label + ", a generator behind its first yield");
  const a = [label.length];
  yield a;
  return a[0];
}
async function stepsGenerator(label) {
  const steps = yields(label);
  steps.next();
  await timer();
  steps.next();
  steps.next();
  return 1;
}
const waits = [waitsOnce, waitsBehindSettledValues, waitsOnOnePath, keepsMoreLater, stepsGenerator];

async function map(n, wait) {
  const holder = new Map([[n, make(n)]]);
  await wait("a map");
  return 1;
}
async function mapFilledBySet(n, wait) {
  const holder = new Map();
  holder.set(n, make(n));
  await wait("a map filled by set");
  return 1;
}
async function set(n, wait) {
  const holder = new Set([make(n)]);
  await wait("a set");
  return 1;
}
async function local(n, wait) {
  const x = make(n);
  sink += x.n;
  await wait("a local");
  return 1;
}
async function list(n, wait) {
  const holder = [n, make(n)];
  sink += holder.length;
  await wait("a list");
  return 1;
}

let n = 0;
for (const wait of waits) {
  for (const holds of [map, mapFilledBySet, set, local, list]) await holds(n++, wait);
}
console.log(sink);
