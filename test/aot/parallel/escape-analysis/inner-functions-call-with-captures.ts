// An inner function that calls itself, or a function declared beside it, hands on what it has captured. A compiler may take that from what the running function was given instead of reading it again,
// and may then skip tests that the running function has passed. Right only while both really belong to ONE activation of the outer function. Every block below has several activations alive at once.
interface Shape { name: string; weight: number; parts: Shape[]; }
const lines: string[] = [];
function say(name: string, ...values: unknown[]) { lines.push(name + " " + values.join(" ")); }
function shape(name: string, weight: number, ...parts: Shape[]): Shape { return { name, weight, parts }; }
const tree = shape("a", 1, shape("b", 2, shape("c", 3), shape("d", 4)), shape("e", 5, shape("f", 6, shape("g", 7))));

function weigh(root: Shape, scale: Shape, labels: string[]): number {
  return walk(root, 0);
  function walk(at: Shape, depth: number): number {
    let sum = at.weight * scale.weight + labels.length;
    for (const part of at.parts) sum += walk(part, depth + 1) + beside(part, depth);
    return sum;
  }
  function beside(at: Shape, depth: number): number { return depth > 1 ? scale.weight : walk(shape(at.name, 0), 9) - labels.length; }
}
{ let t = 0; for (let i = 0; i < 300; i++) t += weigh(tree, shape("s", i & 3), i & 1 ? ["x"] : ["x", "y", "z"]); say("one activation at a time", t); }

function nested(root: Shape, scale: Shape, level: number): number {
  return walk(root);
  function walk(at: Shape): number {
    let sum = at.weight * scale.weight;
    if (level > 0 && at.parts.length === 2) sum += nested(at, shape("inner", scale.weight + 1), level - 1);
    for (const part of at.parts) sum += walk(part);
    return sum + scale.weight;
  }
}
{ let t = 0; for (let i = 0; i < 200; i++) t += nested(tree, shape("s", i % 5), 2); say("the outer function is entered again from inside", t); }

type Walk = (n: number) => number;
function chained(step: Shape, earlier: Walk | undefined): Walk {
  return walk;
  function walk(n: number): number { return n <= 0 ? step.weight : n & 1 && earlier ? earlier(n - 1) + step.weight : walk(n - 1) + step.weight * 10; }
}
{ let w: Walk | undefined; const all: Walk[] = []; for (let i = 1; i <= 6; i++) { w = chained(shape("s", i), w); all.push(w); } let t = 0; for (let r = 0; r < 200; r++) for (const one of all) t += one(r % 7); say("closures of one function from several activations call each other", t); }

function handedOut(scale: Shape, tag: string) {
  function count(at: Shape): number { return at.parts.reduce((sum, part) => sum + count(part), scale.weight); }
  function names(at: Shape): string { return tag + at.name + at.parts.map(names).join(""); }
  return { count, names };
}
{ const kept = [handedOut(shape("s", 1), "-"), handedOut(shape("s", 10), "+"), handedOut(shape("s", 100), "=")]; let t = 0; let text = ""; for (let i = 0; i < 300; i++) { const one = kept[i % 3]; t += one.count(tree); if (i < 3) text += one.names(tree); } say("handed out and called later, in turns", t, text); }

function lied(root: Shape, scale: Shape, labels: string[]): string {
  return walk(root, 0);
  function walk(at: Shape, depth: number): string {
    let text = typeof scale === "object" && scale ? String(scale.weight) : "(" + String(scale) + ")";
    text += Array.isArray(labels) ? labels.length : "[" + String(labels) + "]";
    for (const part of at.parts) text += walk(part, depth + 1);
    return text;
  }
}
{
  let text = "";
  for (let i = 0; i < 120; i++) {
    const scale = (i % 40 === 39 ? (i as unknown) : shape("s", i & 1)) as Shape;
    const labels = (i % 60 === 59 ? ("text" as unknown) : ["l"]) as string[];
    const one = lied(tree, scale, labels); if (i % 20 === 19) text += one + "|";
  }
  say("what is captured is not what its type says", text);
}

function reassigned(root: Shape, start: number): number {
  let scale = start; let seen = 0;
  function walk(at: Shape): number { seen++; if (at.parts.length === 2) scale++; let sum = at.weight * scale; for (const part of at.parts) sum += walk(part); return sum; }
  const first = walk(root); scale = -scale; return first + walk(root) + seen;
}
{ let t = 0; for (let i = 0; i < 300; i++) t += reassigned(tree, i & 7); say("a captured variable changes between and during the calls", t); }

function inLoops(roots: Shape[], scales: Shape[]): number {
  let total = 0; const kept: ((at: Shape) => number)[] = [];
  for (let i = 0; i < roots.length; i++) {
    const scale = scales[i];
    function walk(at: Shape): number { let sum = at.weight + scale.weight; for (const part of at.parts) sum += walk(part); return sum; }
    kept.push(walk); total += walk(roots[i]);
    if (i & 1) { const bonus = shape("bonus", i); const twice = function again(at: Shape, n: number): number { return n ? again(at, n - 1) + bonus.weight + scale.weight : walk(at); }; total += twice(roots[i], 3); }
  }
  for (const one of kept) total += one(roots[0]);
  return total;
}
{ let t = 0; for (let i = 0; i < 150; i++) t += inLoops([tree, tree.parts[0], tree.parts[1]], [shape("s", i & 3), shape("s", 7), shape("s", i % 5)]); say("declared in loops and branches", t); }

function* stepping(root: Shape, scale: Shape): Generator<number> { yield* walk(root); function* walk(at: Shape): Generator<number> { yield at.weight * scale.weight; for (const part of at.parts) yield* walk(part); } }
async function waiting(root: Shape, scale: Shape): Promise<number> { return walk(root); async function walk(at: Shape): Promise<number> { let sum = at.weight * scale.weight; for (const part of at.parts) sum += await walk(part); return sum; } }
{ const a = stepping(tree, shape("s", 2)), b = stepping(tree, shape("s", 3)); let t = 0; for (;;) { const x = a.next(), y = b.next(); if (x.done || y.done) break; t += x.value * 100 + y.value; } say("generators in turns", t); }
{ const results = await Promise.all([waiting(tree, shape("s", 2)), waiting(tree, shape("s", 5)), waiting(tree.parts[1], shape("s", 7))]); say("async functions that overlap", results.join()); }

function throwing(root: Shape, limit: Shape): number {
  try { return walk(root, 0); } catch (error) { return -(error as Shape).weight - limit.weight; }
  function walk(at: Shape, sum: number): number { if (sum > limit.weight) throw at; for (const part of at.parts) sum = walk(part, sum + part.weight); return sum; }
}
{ let t = 0; for (let i = 0; i < 300; i++) t += throwing(tree, shape("limit", i % 30)); say("left by a throw", t); }
console.log(lines.join("\n"));
