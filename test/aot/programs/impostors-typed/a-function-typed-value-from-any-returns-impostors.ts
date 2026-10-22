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

type Step = (n: number) => number;
type Maker = () => { x: number; y: number };
type Lister = (n: number) => number[];
type Namer = () => string;

function half(n: number): number {
  return n / 2;
}

function useStep(f: Step): number {
  const result: number = f(2);
  return half(result) + result;
}

function useMaker(f: Maker): number {
  const p = f();
  return p.x + p.y;
}

function useLister(f: Lister): number {
  let sum = 0;
  for (const value of f(2)) sum += value;
  return sum;
}

function useNamer(f: Namer): number {
  return f().length + f().charCodeAt(0);
}

function honest(label: string): void {
  console.log(label, useStep(n => n + 1), useMaker(() => ({ x: 1, y: 2 })), useLister(n => [n, n]), useNamer(() => "ab"));
}

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) warm += useStep(n => n + i) + useMaker(() => ({ x: i, y: 2 })) + useLister(n => [n, i]) + useNamer(() => "ab");
console.log("2000 honest rounds", warm);

for (const text of ["n => n + 1", "n => String(n)", "n => n + 0.5", "n => -0", "n => null", "n => undefined", "n => 2n", "n => [n]", "n => ({ valueOf() { note('valueOf'); return 6; } })", "n => { throw new RangeError('no'); }", "async n => n", "function* (n) { yield n; }", "n => Symbol()", "n => NaN", "n => 2147483648"]) {
  const typed: Step = hidden(text);
  attempt("step " + text, () => useStep(typed));
  attempt("step called here " + text, () => typed(2) + 1);
  attempt("step result in a typed local " + text, () => {
    const n: number = typed(2);
    const list: number[] = [n, n];
    return list;
  });
  attempt("step result compared " + text, () => typed(2) > 1);
  attempt("step as a callback " + text, () => [1, 2].map(typed));
}

for (const text of ["() => ({ x: 1, y: 2 })", "() => ({ y: 2, x: 1 })", "() => ({ x: '1', y: 2 })", "() => ({ x: 1 })", "() => null", "() => 5", "() => [1, 2]", "() => ({ get x() { note('get-x'); return 1; }, y: 2 })", "() => new Proxy({}, { get(t, k) { note('get:' + String(k)); return 3; } })"]) {
  const typed: Maker = hidden(text);
  attempt("maker " + text, () => useMaker(typed));
  attempt("maker destructured " + text, () => {
    const { x, y } = typed();
    return x * y;
  });
}

for (const text of ["n => [n, n]", "n => [n, 'x']", "n => 'ab'", "n => new Set([n, 1])", "n => ({ length: 1, 0: n })", "n => null", "n => [n, , n]", "n => new Float64Array([n, 0.5])", "function* (n) { yield n; yield n; }", "n => new (class extends Array { *[Symbol.iterator]() { yield 100; } })(n)"]) {
  const typed: Lister = hidden(text);
  attempt("lister " + text, () => useLister(typed));
  attempt("lister length " + text, () => typed(2).length);
  attempt("lister element " + text, () => typed(2)[1] + 1);
}

for (const text of ["() => 'ab'", "() => new String('ab')", "() => ['a', 'b']", "() => 12", "() => null", "() => ({ length: 1, charCodeAt() { return 'c'; } })"]) {
  const typed: Namer = hidden(text);
  attempt("namer " + text, () => useNamer(typed));
  attempt("namer glued " + text, () => typed() + "!");
}

honest("honest after");
