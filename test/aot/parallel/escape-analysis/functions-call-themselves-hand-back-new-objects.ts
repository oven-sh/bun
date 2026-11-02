// Functions that call themselves and hand back a new object, a new pair, or one of several shapes. Callers take the result apart, keep it, compare it with another or change it.
interface Sum { sum: number; count: number }

function walk(depth: number, n: number): Sum {
  if (depth === 0) return { sum: n, count: 1 };
  const { sum, count } = walk(depth - 1, n + 1);
  return { sum: sum + n, count: count + 1 };
}

function pairs(depth: number, n: number): [number, number] {
  if (depth === 0) return [n, 1];
  const [sum, count] = pairs(depth - 1, n + 1);
  return [sum + n, count + 1];
}

type Found = { ok: true; depth: number; path: string } | { ok: false; reason: string };
function find(depth: number, wanted: number): Found {
  if (depth > 6) return { ok: false, reason: "too deep for " + wanted };
  if (depth === wanted) return { ok: true, depth, path: "" + depth };
  const below = find(depth + 1, wanted);
  if (!below.ok) return below;
  return { ok: true, depth: below.depth, path: depth + "/" + below.path };
}

function orNothing(depth: number): Sum | null {
  if (depth < 0) return null;
  const below = orNothing(depth - 2);
  return below ? { sum: below.sum + depth, count: below.count + 1 } : { sum: depth, count: 1 };
}

function even(n: number): { steps: number; last: string } {
  if (n === 0) return { steps: 0, last: "even" };
  const { steps, last } = odd(n - 1);
  return { steps: steps + 1, last };
}
function odd(n: number): { steps: number; last: string } {
  if (n === 0) return { steps: 0, last: "odd" };
  const { steps, last } = even(n - 1);
  return { steps: steps + 1, last };
}

const kept: Sum[] = [];
function keepsEveryLevel(depth: number): Sum {
  if (depth === 0) return { sum: 0, count: 0 };
  const below = keepsEveryLevel(depth - 1);
  kept.push(below);
  return { sum: below.sum + depth, count: below.count + 1 };
}

function changesWhatItGets(depth: number): Sum {
  if (depth === 0) return { sum: 1, count: 1 };
  const below = changesWhatItGets(depth - 1);
  below.sum *= 2;
  below.count++;
  return below;
}

function namesOnTheStack(depth: number): { names: string[]; depth: number } {
  if (depth === 0) {
    const lines = (new Error("here").stack ?? "").split("\n").filter(line => line.includes("namesOnTheStack"));
    return { names: lines.map(() => "namesOnTheStack"), depth };
  }
  const { names } = namesOnTheStack(depth - 1);
  return { names, depth };
}

function throwsAtTheBottom(depth: number): Sum {
  if (depth === 0) throw new RangeError("the bottom");
  const { sum, count } = throwsAtTheBottom(depth - 1);
  return { sum: sum + 1, count: count + 1 };
}

function twice(depth: number): Sum {
  if (depth === 0) return { sum: 1, count: 1 };
  const left = twice(depth - 1), right = twice(depth - 1);
  return { sum: left.sum + right.sum, count: left.count + right.count + (left === right ? 100 : 0) };
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const { sum, count } = walk(i & 7, i & 3);
  const [pairSum, pairCount] = pairs(i & 7, i & 3);
  total += sum + count * 3 + pairSum * 5 + pairCount * 7;
}
console.log(total);
console.log(JSON.stringify(walk(4, 10)), JSON.stringify(pairs(4, 10)));
for (const wanted of [0, 3, 6, 7, 9]) console.log(JSON.stringify(find(0, wanted)));
for (const depth of [-1, 0, 1, 6, 7]) console.log(JSON.stringify(orNothing(depth)));
console.log(JSON.stringify(even(7)), JSON.stringify(odd(7)), JSON.stringify(even(0)));
const top = keepsEveryLevel(4);
console.log(JSON.stringify(top), JSON.stringify(kept), new Set(kept).size, kept.includes(top));
console.log(JSON.stringify(changesWhatItGets(5)));
console.log(JSON.stringify(namesOnTheStack(3)));
try {
  console.log(throwsAtTheBottom(3));
} catch (error) {
  console.log(String(error));
}
console.log(JSON.stringify(twice(5)));
