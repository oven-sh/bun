function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return value.constructor?.name + "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

function pushed(list: number[]): number {
  return list.push(123);
}

function popped(list: number[]): number | undefined {
  return list.pop();
}

function doubled(list: number[]): number[] {
  return list.map(value => value * 2);
}

function kept(list: number[]): number[] {
  return list.filter(value => value > 1);
}

function summed(list: number[]): number {
  return list.reduce((sum, value) => sum + value, 0);
}

function sorted(list: number[]): number[] {
  return list.sort((a, b) => a - b);
}

function found(list: number[]): number {
  return list.indexOf(2);
}

function has(list: number[]): boolean {
  return list.includes(NaN);
}

function joined(list: number[]): string {
  return list.join("+");
}

function sliced(list: number[]): number[] {
  return list.slice(1);
}

function chained(list: number[]): number[] {
  return list.concat([7]);
}

function last(list: number[]): number | undefined {
  return list.at(-1);
}

function honest(label: string): void {
  const list = [3, 1, 2];
  console.log(
    label,
    pushed(list),
    popped(list),
    show(doubled(list)),
    show(kept(list)),
    summed(list),
    show(sorted(list)),
    found(list),
    has(list),
    joined(list),
    show(sliced(list)),
    show(chained(list)),
    last(list),
  );
}

const hidden = (text: string): any => (0, eval)("(" + text + ")");

const texts = [
  "[3, 1, 2]",
  "['3', '1', '2']",
  "[3, , 2]",
  "[NaN, -0]",
  "{ length: 2, 0: 3, 1: 2 }",
  "{ length: 2, 0: 3, 1: 2, __proto__: Array.prototype }",
  "{ push() { return 'pushed'; }, pop() { return 'popped'; }, map() { return 'mapped'; }, filter() { return 'filtered'; }, reduce() { return 'reduced'; }, sort() { return 'sorted'; }, indexOf() { return 'found'; }, includes() { return 'has'; }, join() { return 5; }, slice() { return 'sliced'; }, concat() { return 'chained'; }, at() { return 'last'; } }",
  "new (class Stack extends Array { push() { return 42; } pop() { return 43; } })(3, 1, 2)",
  "new (class Odd extends Array { map() { return 'own map'; } filter() { return [9]; } sort() { return this; } })(3, 1, 2)",
  "new (class Plain extends Array { static get [Symbol.species]() { return Array; } })(3, 1, 2)",
  "new (class Wild extends Array { static get [Symbol.species]() { return function (n) { return { made: n }; }; } })(3, 1, 2)",
  "Object.assign([3, 1, 2], { push() { return 'own push'; }, join() { return 'own join'; }, at: null })",
  "Object.assign([3, 1, 2], { constructor: { [Symbol.species]: Object } })",
  "Object.setPrototypeOf([3, 1, 2], null)",
  "Object.setPrototypeOf([3, 1, 2], { push() { return 'other push'; }, map: Array.prototype.filter })",
  "Object.freeze([3, 1, 2])",
  "Object.seal([3, 1, 2])",
  "Object.preventExtensions([3, 1, 2])",
  "Object.defineProperty([3, 1, 2], 'length', { writable: false })",
  "Object.defineProperty([3, 1, 2], 1, { get() { return 50; }, set(v) {} })",
  "new Proxy([3, 1, 2], {})",
  "new Proxy([3, 1, 2], { set() { return false; } })",
  "new Uint8Array([3, 1, 2])",
  "new Float32Array([3.5, NaN])",
  "'312'",
  "new String('312')",
  "(function () { return arguments; })(3, 1, 2)",
  "new Set([3, 1, 2])",
  "new Array(3)",
  "null",
  "undefined",
  "7",
];

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) {
  const list = [i, 2, 1];
  warm += pushed(list) + (popped(list) ?? 0) + doubled(list).length + kept(list).length + summed(list) + sorted(list)[0] + found(list) + joined(list).length + sliced(list).length + chained(list).length + (last(list) ?? 0) + (has(list) ? 1 : 0);
}
console.log("2000 honest rounds", warm);

for (const text of texts) {
  attempt("summed " + text, () => summed(hidden(text)));
  attempt("found " + text, () => found(hidden(text)));
  attempt("has " + text, () => has(hidden(text)));
  attempt("joined " + text, () => joined(hidden(text)));
  attempt("last " + text, () => last(hidden(text)));
}

honest("honest after");
