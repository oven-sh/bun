function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

(globalThis as any).note = (text: string) => log.push(text);
const hidden = (text: string): any => (0, eval)("(" + text + ")");

interface Point {
  x: number;
  y: number;
}

function total(list: number[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function widths(points: Point[]): number {
  let sum = 0;
  for (const p of points) sum += p.x + p.y;
  return sum;
}

function lengths(words: string[]): number {
  let sum = 0;
  for (let i = 0; i < words.length; i++) sum += words[i].length;
  return sum;
}

function rows(grid: number[][]): number {
  let sum = 0;
  for (const row of grid) for (let i = 0; i < row.length; i++) sum += row[i];
  return sum;
}

function honest(label: string): void {
  console.log(label, total([1, 2]), total([1.5, 2]), widths([{ x: 1, y: 2 }]), lengths(["a", "bc"]), rows([[1], [2, 3]]));
}

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) warm += total([i, 1]) + widths([{ x: i, y: 1 }]) + lengths(["a"]) + rows([[i]]);
console.log("2000 honest rounds", warm);

const values = ["'2'", "2.5", "-0", "2n", "null", "undefined", "true", "[2]", "{}", "{ valueOf() { note('valueOf'); return 2; } }", "NaN", "2147483648"];

for (const text of values) {
  attempt("integers, pushed " + text, () => {
    const list: number[] = [1, 2, 3];
    list.push(hidden(text));
    return [total(list), list];
  });
  attempt("integers, stored by index " + text, () => {
    const list: number[] = [1, 2, 3];
    list[1] = hidden(text);
    return [total(list), list];
  });
  attempt("doubles, stored by index " + text, () => {
    const list: number[] = [1.5, 2.5, 3.5];
    list[1] = hidden(text);
    return [total(list), list];
  });
  attempt("in the literal " + text, () => {
    const list: number[] = [1, hidden(text), 3];
    return [total(list), list];
  });
  attempt("spread in " + text, () => {
    const list: number[] = [1, ...[hidden(text)], 3];
    return [total(list), list];
  });
  attempt("filled " + text, () => {
    const list: number[] = new Array<number>(2).fill(hidden(text));
    return [total(list), list];
  });
  attempt("unshifted and spliced " + text, () => {
    const list: number[] = [1, 2];
    list.unshift(hidden(text));
    list.splice(1, 0, hidden(text));
    return [total(list), list];
  });
  attempt("stored past the end " + text, () => {
    const list: number[] = [1];
    list[3] = hidden(text);
    return [total(list), list];
  });
  attempt("read back into a typed local " + text, () => {
    const list: number[] = [1];
    list[0] = hidden(text);
    const n: number = list[0];
    return n + n;
  });
}

for (const text of ["{ x: 1, y: 2 }", "{ y: 2, x: 1 }", "{ x: '1', y: 2 }", "{ x: 1 }", "null", "undefined", "5", "'xy'", "[1, 2]", "{ get x() { note('get-x'); return 1; }, y: 2 }"]) {
  attempt("points, pushed " + text, () => {
    const list: Point[] = [{ x: 1, y: 1 }];
    list.push(hidden(text));
    return widths(list);
  });
  attempt("points, in the literal " + text, () => widths([{ x: 1, y: 1 }, hidden(text), { x: 2, y: 2 }]));
  attempt("points, mapped " + text, () => {
    const list: Point[] = [{ x: 1, y: 1 }, hidden(text)];
    return list.map(p => p.x);
  });
}

for (const text of ["'abc'", "5", "null", "['a', 'b']", "new String('abc')", "{ length: 'long' }", "undefined"]) {
  attempt("words, pushed " + text, () => {
    const list: string[] = ["a"];
    list.push(hidden(text));
    return [lengths(list), list.join("+")];
  });
  attempt("words, sorted " + text, () => {
    const list: string[] = ["b", hidden(text), "a"];
    return list.sort().map(String);
  });
}

for (const text of ["[1, 2]", "['1']", "'12'", "null", "{ length: 1, 0: 5 }", "new Uint8Array([7])", "5", "[1, , 2]"]) {
  attempt("rows, pushed " + text, () => {
    const grid: number[][] = [[1]];
    grid.push(hidden(text));
    return rows(grid);
  });
}

honest("honest after");
