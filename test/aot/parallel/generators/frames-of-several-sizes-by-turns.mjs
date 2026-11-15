// Generators whose frames have different sizes end and begin by turns, stay suspended, throw, return early and are collected in between.
function* none() {}
function* one(seed) {
  yield seed;
}
function* three(seed) {
  const a = { seed }, b = "b" + seed;
  yield a.seed;
  yield b;
  return [a, b].length;
}
function* seven(seed) {
  const a = { n: 1 }, b = [seed], c = "c" + seed, d = seed * 1.5, e = { b };
  for (let index = 0; index < 3; index++) yield a.n + b[0] + c.length + d + e.b.length + index;
  a.n++;
  yield a;
}
function* many(seed) {
  const v = [{ n: seed }, "s" + seed, seed / 3, [seed]];
  const a = { n: 1 }, b = { n: 2 }, c = { n: 3 }, d = { n: 4 }, e = { n: 5 }, f = { n: 6 }, g = { n: 7 }, h = { n: 8 }, i = { n: 9 }, j = { n: 10 };
  yield v.length;
  yield a.n + b.n + c.n + d.n + e.n + f.n + g.n + h.n + i.n + j.n;
  yield v[1] + v[3];
}
class Tree {
  constructor(value, children) {
    this.value = value;
    this.children = children;
  }
  *entries() {
    for (const child of this.children) yield { child, leaf: child.children.length === 0 };
  }
  *leaves() {
    for (const { child, leaf } of this.entries()) {
      if (leaf) yield child.value;
      else yield* child.leaves();
    }
  }
  *nodes() {
    for (const entry of this.entries()) {
      if (entry.leaf) continue;
      yield* entry.child.nodes();
      yield entry.child;
    }
  }
}
function grow(depth, width) {
  return new Tree(depth * 10 + width, depth ? Array.from({ length: width }, (_, index) => grow(depth - 1, (index % width) + 1)) : []);
}
let garbage;
function collect(count) {
  garbage = [];
  for (let index = 0; index < count; index++) garbage.push({ index });
}
const kinds = [none, one, three, seven, many], show = value => (value && typeof value === "object" ? JSON.stringify(value) : String(value));
const out = [], kept = [];
for (let round = 0; round < 200; round++) {
  let text = "";
  const open = kinds.map(kind => kind(round));
  for (let step = 0; step < 5; step++) {
    for (const [place, generator] of open.entries()) {
      const result = generator.next();
      text += show(result.value)[0] + (result.done ? "!" : "");
      if (result.done) open[place] = kinds[(place + step) % kinds.length](round + step);
    }
  }
  kept.push(open[round % open.length]);
  for (const generator of open) if (round % 3 === 0) generator.return();
  if (round % 7 === 0) {
    const thrown = seven(round);
    thrown.next();
    try {
      thrown.throw(new Error("in"));
    } catch (error) {
      text += error.message;
    }
    text += show(thrown.next().done);
  }
  if (round % 20 === 0) collect(5000);
  if (round % 25 === 0) out.push(text);
}
const tree = grow(4, 4);
let leaves = 0, nodes = 0;
for (let round = 0; round < 20; round++) {
  for (const value of tree.leaves()) leaves = (leaves * 31 + value) | 0;
  for (const node of tree.nodes()) nodes = (nodes * 7 + node.value + [...node.leaves()].length) | 0;
  for (const value of tree.leaves()) if (value > 2) break;
}
out.push(leaves, nodes);
let rest = 0;
for (const generator of kept) for (let result = generator.next(); !result.done; result = generator.next()) rest = (rest * 31 + show(result.value).length) | 0;
out.push(rest, garbage.length);
console.log(out.join("\n"));
