// The inner for-of stands under the cleanup of the outer one and adds up what it steps. The rows are written to hold numbers; some do, some lie, some throw in the middle.
function total(rows: number[][]): unknown {
  let sum = 0;
  for (const row of rows) { for (const one of row) sum += one; }
  return sum;
}
function longest(rows: number[][]): number {
  let most = -Infinity, turns = 0;
  for (const row of rows) { let here = 0; for (const one of row) { here += one; turns++; } if (here > most) most = here; }
  return most + turns / 1000;
}
function untilNegative(rows: number[][]): number {
  let sum = 0;
  outer: for (const row of rows) { for (const one of row) { if (one < 0) break outer; if (one === 0) continue outer; sum += one; } }
  return sum;
}
function tried(run: () => unknown): string {
  try { const answer = run(); return typeof answer + ":" + String(answer); } catch (error) { return "thrown:" + String((error as Error).message ?? error); }
}
const hidden = <T,>(value: T): T => JSON.parse(JSON.stringify({ value })).value;
const whole = hidden([[1, 2, 3], [], [4], [5, 6, 7, 8, 9, 10, 11, 12, 13]]);
const fractions = hidden([[0.5, 1.25], [2 ** 40, -0.75], [1e300, 1e300]]);
const mixed = hidden([[1, 2.5], [3], [2 ** 31, -(2 ** 31) - 1]]);
for (let turn = 0; turn < 3; turn++) {
  console.log(tried(() => total(whole)), tried(() => total(fractions)), tried(() => total(mixed)), tried(() => total([])));
  console.log(longest(whole), longest(fractions), longest(mixed), untilNegative(hidden([[1, 2], [0, 50], [3, -1, 70], [9]])));
}
let closed = "";
function stepped(name: string, values: unknown[], failsAt = -1): Iterable<number> {
  return {
    [Symbol.iterator]() {
      let at = 0;
      return {
        next() { if (at === failsAt) throw new Error(name + " fails at " + at); return at < values.length ? { done: false, value: values[at++] as number } : { done: true, value: undefined as never }; },
        return() { closed += name + ";"; return { done: true, value: undefined as never }; },
      };
    },
  };
}
const holes = [1, , 3] as number[];
const lies: unknown[] = [
  [[1, "two", 3], [4]],
  [["a"], [1, 2]],
  [[1, 2], "34"],
  [[1n, 2n]],
  [[1, 2n]],
  [[1, undefined, 2]],
  [[1, null, 2]],
  [holes],
  [[1, { valueOf() { return 41; } }]],
  [[1, { valueOf() { throw new Error("no number"); } }, 2], [3]],
  [[1, Symbol.iterator]],
  [new Set([1, 2]), new Float64Array([0.5, 0.25]), new Map([[1, 2]]).keys()],
  [[1], 7],
  [[1], undefined],
  stepped("outer", [[1, 2], stepped("inner", [3, 4]), [5]]),
  stepped("outer", [[1, 2], stepped("inner", [3, 4], 1), [5]]),
  stepped("outer", [[1, 2], [3]], 1),
  stepped("outer", [[1, { valueOf() { throw new Error("inside"); } }], [3]]),
];
for (const list of lies) {
  closed = "";
  console.log(tried(() => total(list as number[][])), closed);
}
closed = "";
console.log(untilNegative(stepped("outer", [stepped("inner", [1, 2, -1, 9]), [5]]) as unknown as number[][]), closed);
console.log(tried(() => total(whole)), longest(whole));
const grows = [[1, 2]];
let seen = 0;
for (const row of grows) { for (const one of row) { seen += one; if (grows.length < 4) grows.push([one, seen]); if (row.length < 3) row.push(seen); } }
console.log(seen, JSON.stringify(grows));
export {};
