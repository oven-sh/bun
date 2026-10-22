function makePair() {
  let left: number = 0, right: number = 0;
  return {
    set(l: number, r: number): void { left = l; right = r; },
    less(): boolean { return left < right; },
    lessOrEqual(): boolean { return left <= right; },
    greater(): boolean { return left > right; },
    greaterOrEqual(): boolean { return left >= right; },
    sum(): number { return left + right; },
    difference(): number { return left - right; },
    countBelow(limit: number): number { let count = 0; while (left < right && count < limit) { left++; count++; } return count; },
  };
}

const values: any[] = [
  0, -0, 1, -1, 7, 2147483647, -2147483648, 2147483648, -2147483649, 4294967296, 0.5, -0.5, 1e300, NaN, Infinity, -Infinity,
  undefined, null, true, false, "", "3", " 7 ", "x", 10n, -1n, { valueOf() { return 4; } }, { toString() { return "6"; } }, [5], [], Symbol.iterator,
];

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function attempt(operation: () => unknown): string {
  try { return show(operation()); } catch (error) { return (error as Error).name; }
}

const pair = makePair();
for (let i = 0; i < values.length; i++) {
  const line: string[] = [];
  for (let j = 0; j < values.length; j++) {
    pair.set(values[i], values[j]);
    const relations = [pair.less, pair.lessOrEqual, pair.greater, pair.greaterOrEqual].map(attempt).map(text => text === "true" ? "1" : text === "false" ? "0" : "!").join("");
    line.push(relations + " " + attempt(pair.sum) + " " + attempt(pair.difference));
  }
  console.log(i, line.join(" | "));
}

for (const [from, to] of [[0, 5], [2147483645, 2147483650], [-0.5, 2], ["1", 4], [1, "4"], [undefined, 3], [3, undefined], [null, 2], [0, NaN]] as any[]) {
  pair.set(from, to);
  console.log(show(from), show(to), attempt(() => pair.countBelow(10)), attempt(pair.sum));
}
