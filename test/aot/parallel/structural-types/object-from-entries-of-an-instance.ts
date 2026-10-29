function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

class Score {
  math = 90;
  art = 72.5;
  music = 60;
  best(): number {
    return Math.max(this.math, this.art, this.music);
  }
}

interface Partly {
  math?: number;
  art?: number;
  extra?: number;
}

function rebuilt(score: Score): Record<string, number> {
  return Object.fromEntries(Object.entries(score));
}

function partly(score: Score): Partly {
  return Object.fromEntries(Object.entries(score));
}

function doubled(score: Score): Record<string, number> {
  return Object.fromEntries(Object.entries(score).map(([key, value]) => [key, value * 2]));
}

function reversed(score: Score): Record<string, number> {
  return Object.fromEntries(Object.entries(score).reverse());
}

function total(scores: Record<string, number>): number {
  let sum = 0;
  for (const key in scores) sum += scores[key];
  return sum;
}

function mathOf(scores: Partly): number {
  return (scores.math ?? 0) + (scores.extra ?? 0);
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += total({ a: i, b: 0.5 }) + mathOf({ math: i }) + new Score().best();
console.log("after 2000 honest records", warm);

attempt("rebuilt", () => [rebuilt(new Score()), total(rebuilt(new Score())), Object.keys(rebuilt(new Score()))]);
attempt("what it is", () => [rebuilt(new Score()) instanceof Score, typeof rebuilt(new Score()).best, Object.getPrototypeOf(rebuilt(new Score())) === Object.prototype]);
attempt("a name that is not there", () => [rebuilt(new Score()).history, rebuilt(new Score()).history + 1]);
attempt("an inherited name", () => typeof rebuilt(new Score()).constructor);
attempt("as a type with optional members", () => [mathOf(partly(new Score())), partly(new Score()).art, Object.keys(partly(new Score()))]);
attempt("doubled", () => [doubled(new Score()), total(doubled(new Score()))]);
attempt("reversed", () => [Object.keys(reversed(new Score())), JSON.stringify(reversed(new Score()))]);
attempt("an instance with a member of another kind behind the type", () => {
  const score = new Score();
  const wide: { art: number | string } = score;
  wide.art = "good";
  return [total(rebuilt(score)), typeof rebuilt(score).art];
});
attempt("from a map", () => {
  const scores: Record<string, number> = Object.fromEntries(new Map([["a", 1], ["b", 2]]));
  return [total(scores), Object.keys(scores)];
});
attempt("keys that look like indexes come first", () => Object.keys(Object.fromEntries([["b", 1], ["1", 2], ["a", 3], ["0", 4]])));
attempt("a key that is repeated", () => Object.fromEntries([["a", 1], ["b", 2], ["a", 3]]));
attempt("__proto__ as a key", () => {
  const made: Record<string, number> = Object.fromEntries([["__proto__", 5]]);
  return [Object.keys(made), made["__proto__"], Object.getPrototypeOf(made) === Object.prototype];
});
attempt("entries of a proxy", () => {
  const log: string[] = [];
  const watched = new Proxy(new Score(), { get: (target, key, receiver) => (log.push(String(key)), Reflect.get(target, key, receiver)) });
  return [total(rebuilt(watched)), log];
});
attempt("honest again", () => [total({ a: 1 }), mathOf({ math: 1 })]);
