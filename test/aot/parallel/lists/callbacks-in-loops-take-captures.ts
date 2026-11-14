// Methods of lists of numbers called in loops with closures that capture values nobody knows: parameters, elements, the counter; lists of every kind.
// STATISTIC: NumberCallbacksCopiedInLoops >= 5
function addsParameter(a: number[], n: number, k: number): number {
  let t = 0;
  for (let r = 0; r < n; r++) t += a.map(x => x + k)[2]!;
  return t;
}
function addsElement(a: number[], b: number[], n: number): number {
  let t = 0;
  for (let r = 0; r < n; r++) {
    const j = b[1]!;
    t += a.map(x => x + j)[2]!;
  }
  return t;
}
function addsCounter(a: number[], b: number[], n: number): number {
  let t = 0;
  for (let r = 0; r < n; r++) t += a.map(x => x + r)[2]!;
  return t;
}
function keepsAbove(a: number[], b: number[], n: number): number {
  let t = 0;
  for (let r = 0; r < n; r++) {
    const j = b[r]!;
    t += a.filter(x => x > j).length;
  }
  return t;
}
function asksSome(a: number[], b: number[], n: number): number {
  let t = 0;
  for (let r = 0; r < n; r++) {
    const j = b[r]!;
    if (a.some(x => x === j)) t++;
  }
  return t;
}
function sumsBeside(a: number[], b: number[], n: number): number {
  let t = 0;
  for (let r = 0; r < n; r++) {
    const j = b[r]!;
    t += a.reduce((s, x) => s + x * j, 0);
  }
  return t;
}
function findsFirst(a: number[], b: number[], n: number): number {
  let t = 0;
  for (let r = 0; r < n; r++) {
    const j = b[r]!;
    t += a.findIndex(x => x > j);
  }
  return t;
}
const lists: Record<string, () => any> = {
  ints: () => [1, 2, 3, 4, 5],
  doubles: () => [0.5, 1.5, 2.5, 3.5, 4.5],
  "late double": () => [1, 2, 3, 4, 5.5],
  mixed: () => [1, "2", null, 4.5, undefined],
  texts: () => ["a", "b", "c", "d", "e"],
  holes: () => [1, , 3, , 5],
  empty: () => [],
  "not a number": () => [NaN, -0, Infinity, 0, 1],
  far: () => [2147483647, 2147483648, -2147483649, 1, 2],
  bigints: () => [1n, 2n, 3n, 4n, 5n],
  objects: () => [{ valueOf: () => 3 }, 2, 3, 4, 5],
  view: () => new Float64Array([0.5, 1, 2, 3, 4]),
  frozen: () => Object.freeze([1, 2, 3, 4, 5]),
  "own method": () => Object.assign([1, 2, 3], { map: () => [0, 0, "own"], filter: () => "own", some: () => 1, reduce: () => 7, findIndex: () => 9 }),
  nothing: () => undefined,
};
const captures: any[] = JSON.parse('[1, 2.5, "t", null, -3]');
const functions: Record<string, (a: any, b: any, n: any) => any> = { addsElement, addsCounter, keepsAbove, asksSome, sumsBeside, findsFirst };
const word = (value: any): string => (Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? "'" + value : String(value));
for (let times = 0; times < 2; times++) {
  for (const kind of Object.keys(lists)) {
    for (const other of ["ints", "doubles", "mixed", "holes"]) {
      const said: string[] = [];
      for (const name of Object.keys(functions)) {
        try {
          said.push(word(functions[name]!(lists[kind]!(), lists[other]!(), 4)));
        } catch (error: any) {
          said.push(error.name);
        }
      }
      for (const k of captures) {
        try {
          said.push(word(addsParameter(lists[kind]!(), 3, k)));
        } catch (error: any) {
          said.push(error.name);
        }
      }
      console.log(kind, other, said.join(" "));
    }
  }
}
