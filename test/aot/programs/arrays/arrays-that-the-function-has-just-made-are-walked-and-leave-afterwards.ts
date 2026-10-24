// Arrays that the function itself has just made are walked, and leave the function only afterwards.
const outside: any = (globalThis as any)[process.argv[2] ?? "Array"];

function literalThenLeaves(a: number, b: number): number {
  const xs = [a, b];
  let s = 0;
  for (const x of xs) s += x;
  outside(xs);
  return s;
}

function pushedThenLeaves(n: number): number {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(i * 2);
  let s = 0;
  for (const x of out) s += x;
  outside(out);
  return s;
}

function filteredThenLeaves(xs: number[]): number {
  const kept = xs.filter(x => x > 1);
  let s = 0;
  for (const x of kept) s += x;
  outside(kept);
  return s;
}

function spreadOfFresh(a: number, b: number): number {
  const xs = [a, b];
  const ys = [0, ...xs];
  outside(xs);
  return ys.length + ys[1];
}

function patternOfFresh(a: number, b: number): number {
  const xs = [a, b];
  const [p, q] = xs;
  outside(xs);
  return p - q;
}

function walkedTwice(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  for (const x of xs) s -= x >> 1;
  return s;
}

interface Item { kind: number; weight: number; name: string; parts: number[] }

function ordinaryLoop(items: Item[], limit: number): number {
  let total = 0;
  let names = 0;
  for (const item of items) {
    if (item.kind === 1) {
      total += item.weight;
      if (total > limit) total -= limit;
    } else if (item.kind === 2) {
      total -= item.weight >> 1;
      names += item.name.length;
    } else {
      for (const part of item.parts) {
        if (part > limit) throw new RangeError("part " + part + " of " + item.name);
        total += part;
      }
    }
    if (names > 1000) names = 0;
  }
  return total + names;
}

const items: Item[] = [];
for (let i = 0; i < 12; i++) items.push({ kind: i % 3, weight: i, name: "n" + i, parts: [i, i + 1] });
outside(items);

let sum = 0;
const given = [1, 2, 3, 4];
outside(given);
for (let i = 0; i < 200000; i++) {
  sum += literalThenLeaves(i, 1);
  sum += pushedThenLeaves(3);
  sum += filteredThenLeaves(given);
  sum += spreadOfFresh(i, 2);
  sum += patternOfFresh(i, 3);
  sum += walkedTwice(given);
  sum += ordinaryLoop(items, 100000);
  sum %= 1000003;
}
console.log(sum);
