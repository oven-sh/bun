// Loops that store one value at every n-th position: lists of every kind, holes, lists that take no stores, bounds beyond the length, views.
function show(list: ArrayLike<unknown>) {
  let holes = 0, text = "";
  for (let i = 0; i < list.length; i++) {
    if (!(i in list)) { holes++; text += "_"; continue; }
    text += Object.is(list[i], -0) ? "-0" : String(list[i])[0];
  }
  return list.length + ":" + holes + ":" + (text.length > 60 ? text.slice(0, 30) + text.slice(-30) : text);
}
function sieve(n: number) {
  const prime = new Array(n).fill(true);
  let count = 0;
  for (let i = 2; i < n; i++) {
    if (!prime[i]) continue;
    count++;
    for (let k = i * 2; k < n; k += i) prime[k] = false;
  }
  return count;
}
function sieveOfBytes(flags: Uint8Array) {
  flags.fill(1);
  let count = 0;
  for (let i = 2; i < flags.length; i++) {
    if (!flags[i]) continue;
    count++;
    for (let k = i * i; k < flags.length; k += i) flags[k] = 0;
  }
  return count;
}
function mark(list: unknown[], from: number, bound: number, step: number, value: boolean) { for (let k = from; k < bound; k += step) list[k] = value; return list; }
function markUpTo(list: number[], from: number, last: number, step: number) { for (let k = from; k <= last; k += step) list[k] = 7; return list; }
function markAny(list: unknown[], from: number, bound: number, step: number, value: unknown) { let k = from; while (k < bound) { list[k] = value; k += step; } return k; }
for (const n of [0, 1, 2, 10, 100, 1000, 40000]) console.log(n, sieve(n), sieveOfBytes(new Uint8Array(n)));
const lists: (() => unknown[])[] = [
  () => new Array(50).fill(true), () => new Array(50).fill(0), () => new Array(50).fill(0.5), () => new Array(50), () => [], () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
  () => Object.freeze(new Array(50).fill(1)) as unknown[], () => Object.seal(new Array(50).fill(1)), () => Object.preventExtensions(new Array(50).fill(1)), () => { const l = new Array(50).fill(1); delete l[12]; return l; },
  () => { const l: unknown[] = []; l[49] = 1; return l; }, () => Array.from({ length: 50 }, (_, i) => ({ i })),
];
for (const make of lists) {
  for (const [from, bound, step] of [[0, 50, 1], [4, 50, 3], [0, 20, 5], [3, 60, 7], [9, 50, 41], [50, 50, 2], [-3, 20, 4]]) {
    for (const change of [(l: unknown[]) => mark(l, from, bound, step, false), (l: unknown[]) => markUpTo(l as number[], from, bound, step), (l: unknown[]) => markAny(l, from, bound, step, "s"), (l: unknown[]) => markAny(l, from, bound, step, l), (l: unknown[]) => markAny(l, from, bound, step, 0.25)]) {
      const list = make();
      try { change(list); console.log(show(list)); } catch (e) { console.log((e as Error).name, show(list)); }
    }
  }
}
