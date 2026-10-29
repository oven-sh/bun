// `(o as any).n as number | null | undefined`, and the same for boolean, string and arrays: a property read by name and cast on the spot. The read must accept and reject exactly what a cast of a variable accepts and rejects, and must hand on an accepted value unchanged, in and outside `try`. What a cast of a variable does is found out as the program runs, so it prints the same with types, with types erased and in plain Bun. Then two reads in a row, and a read that is only tested, with getters that throw: the stack names the line of the read that threw. Four rows differ from plain Bun, with or without the types: its transpiler puts a constant that is used once in the place of its use, so `const b = a.b; return b.c` runs as `return a.b.c` there and the second read is reported at the line of the first.
type Kind = "number" | "boolean" | "string" | "array";
type Read = (o: unknown) => unknown;

const rounds = 40;
const rejected = Symbol("rejected");
const hidden: any = JSON.parse('["text"]');

function castToNumber(value: unknown): unknown {
  return value as number | null | undefined;
}
function castToBoolean(value: unknown): unknown {
  return value as boolean | null | undefined;
}
function castToString(value: unknown): unknown {
  return value as string | null | undefined;
}
function castToArray(value: unknown): unknown {
  return value as unknown[] | null | undefined;
}

function numberOf(o: unknown): number | null | undefined {
  return (o as any).n as number | null | undefined;
}
function booleanOf(o: unknown): boolean | null | undefined {
  return (o as any).n as boolean | null | undefined;
}
function stringOf(o: unknown): string | null | undefined {
  return (o as any).n as string | null | undefined;
}
function arrayOf(o: unknown): unknown[] | null | undefined {
  return (o as any).n as unknown[] | null | undefined;
}
function numberInTry(o: unknown): unknown {
  try {
    return (o as any).n as number | null | undefined;
  } catch (error) {
    return error instanceof TypeError ? rejected : error;
  }
}
function booleanInTry(o: unknown): unknown {
  try {
    return (o as any).n as boolean | null | undefined;
  } catch (error) {
    return error instanceof TypeError ? rejected : error;
  }
}
function stringInTry(o: unknown): unknown {
  try {
    return (o as any).n as string | null | undefined;
  } catch (error) {
    return error instanceof TypeError ? rejected : error;
  }
}
function arrayInTry(o: unknown): unknown {
  try {
    return (o as any).n as unknown[] | null | undefined;
  } catch (error) {
    return error instanceof TypeError ? rejected : error;
  }
}

const reads: [Kind, string, Read, Read][] = [
  ["number", "outside try", numberOf, castToNumber],
  ["number", "in try", numberInTry, castToNumber],
  ["boolean", "outside try", booleanOf, castToBoolean],
  ["boolean", "in try", booleanInTry, castToBoolean],
  ["string", "outside try", stringOf, castToString],
  ["string", "in try", stringInTry, castToString],
  ["array", "outside try", arrayOf, castToArray],
  ["array", "in try", arrayInTry, castToArray],
];

const sources: [string, (value: unknown) => unknown][] = [
  ["literal", value => ({ n: value })],
  ["from entries", value => Object.fromEntries([["n", value]])],
  ["out of line", value => Object.fromEntries([..."abcdefghijkl"].map(key => [key, 0] as [string, unknown]).concat([["n", value]]))],
  ["inherited", value => Object.create(Object.fromEntries([["n", value]]))],
  ["getter", value => ({ get n() { return value; } })],
  ["proxy", value => new Proxy({}, { get: () => value })],
];

class List extends Array<unknown> {}
const values: unknown[] = [0, 1, -1, 1.5, -0, NaN, Infinity, 2 ** 31, true, false, "", "text", null, undefined, [], [1, "two"], new List(), {}, () => 1, 10n, Symbol.iterator, new Date(0), new Uint8Array(1)];

function fits(kind: Kind, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  switch (kind) {
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string";
    case "array":
      return Array.isArray(value);
  }
}

function describe(value: unknown): string {
  if (value === rejected) return "rejected";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return Array.isArray(value) ? "array" : "object";
  return String(value);
}

function attempt(read: Read, o: unknown): unknown {
  try {
    return read(o);
  } catch (error) {
    return error instanceof TypeError ? rejected : error;
  }
}

function isSameAsCast(result: unknown, cast: Read, value: unknown): boolean {
  return Object.is(result, attempt(cast, value));
}

function verdictOf(label: string, value: unknown, read: Read, cast: Read, o: unknown): string {
  for (let round = 0; round < rounds; round++) {
    const result = attempt(read, o);
    if (!isSameAsCast(result, cast, value)) return "WRONG(" + describe(result) + " in round " + round + ")";
  }
  return label;
}

for (const [kind, where, read, cast] of reads) {
  console.log(kind, where, "a value that fits passes the cast:", values.every(value => !fits(kind, value) || Object.is(attempt(cast, value), value)));
  for (const [source, create] of sources) console.log(kind, where, source + ":", values.map(value => verdictOf(fits(kind, value) ? "fits" : "other", value, read, cast, create(value))).join(" "));
  console.log(kind, where, "absent:", [{}, Object.create(null), [], 5, "text", true].map(o => describe(attempt(read, o))).join(" "));
  console.log(kind, where, "no receiver:", [null, undefined].map(o => describe(attempt(read, o))).join(" "));
}

// One site meets every value in turn, so what it cached for the last receiver never answers for the next.
for (const [kind, where, read, cast] of reads) {
  const receivers = values.flatMap(value => sources.map(([, create]) => [value, create(value)] as [unknown, unknown]));
  let wrong = 0;
  for (let round = 0; round < rounds; round++) {
    for (const [value, o] of receivers) {
      if (!isSameAsCast(attempt(read, o), cast, value)) wrong++;
    }
  }
  console.log(kind, where, "in turn:", wrong, "wrong of", rounds * receivers.length);
}

function lineIn(name: string, error: unknown): string {
  const found = String((error as Error).stack)
    .split("\n")
    .find(line => line.includes("at " + name + " "));
  return /:(\d+):\d+\)?$/.exec(found ?? "")?.[1] ?? "none";
}
const fail = (): never => {
  throw new Error("from a getter");
};
function report(label: string, name: string, run: () => unknown): void {
  const outcomes = new Set<string>();
  for (let round = 0; round < rounds; round++) {
    try {
      outcomes.add("returned " + describe(run()));
    } catch (error) {
      outcomes.add((error as Error).constructor.name + " at line " + lineIn(name, error));
    }
  }
  console.log(label + ":", [...outcomes].join(" | "));
}

function chain(a: any): unknown {
  const b = a.b;
  return b.c;
}
function chainOnOneLine(a: any): unknown {
  return a.b.c;
}
function chainKeepingBoth(a: any): unknown {
  const b = a.b;
  const c = b.c;
  return [b, c].length;
}
// prettier-ignore
function pair(o: any): unknown {
  return {
    x: o.x,
    y: o.y,
  };
}
// prettier-ignore
function pairOfTwoObjects(o: any, p: any): unknown {
  return {
    x: o.x,
    y: p.y,
  };
}
function kindIsText(o: any): string {
  if (o.kind === "text") return "text";
  return "other";
}
function flagIsSet(o: any): string {
  if (o.flag) return "set";
  return "clear";
}
function chainInTry(a: any): unknown {
  try {
    const b = a.b;
    return b.c;
  } catch (error) {
    return (error as Error).constructor.name + " at line " + lineIn("chainInTry", error);
  }
}

const throwsOnB: any = { get b() { return fail(); } };
const throwsOnC: any = { b: { get c() { return fail(); } } };
const throwsOnX: any = { get x() { return fail(); }, y: 2 };
const throwsOnY: any = { x: 1, get y() { return fail(); } };
const complete: any = { b: { c: "c" }, x: 1, y: 2, kind: "text", flag: 1, n: 1 };

report("chain, first read", "chain", () => chain(throwsOnB));
report("chain, second read", "chain", () => chain(throwsOnC));
report("chain, nothing to read from", "chain", () => chain({ b: null }));
report("chain, no receiver", "chain", () => chain(undefined));
report("chain", "chain", () => chain(complete));
report("chain on one line, first read", "chainOnOneLine", () => chainOnOneLine(throwsOnB));
report("chain on one line, second read", "chainOnOneLine", () => chainOnOneLine(throwsOnC));
report("chain on one line", "chainOnOneLine", () => chainOnOneLine(complete));
report("chain keeping both, first read", "chainKeepingBoth", () => chainKeepingBoth(throwsOnB));
report("chain keeping both, second read", "chainKeepingBoth", () => chainKeepingBoth(throwsOnC));
report("chain keeping both", "chainKeepingBoth", () => chainKeepingBoth(complete));
report("chain in try, first read", "chainInTry", () => chainInTry(throwsOnB));
report("chain in try, second read", "chainInTry", () => chainInTry(throwsOnC));
report("pair, first read", "pair", () => pair(throwsOnX));
report("pair, second read", "pair", () => pair(throwsOnY));
report("pair, no receiver", "pair", () => pair(null));
report("pair", "pair", () => JSON.stringify(pair(complete)));
report("pair of two objects, first read", "pairOfTwoObjects", () => pairOfTwoObjects(throwsOnX, complete));
report("pair of two objects, second read", "pairOfTwoObjects", () => pairOfTwoObjects(complete, throwsOnY));
report("pair of two objects, no second receiver", "pairOfTwoObjects", () => pairOfTwoObjects(complete, null));
report("compared read", "kindIsText", () => kindIsText({ get kind() { return fail(); } }));
report("compared read, no receiver", "kindIsText", () => kindIsText(null));
report("compared read, values", "kindIsText", () => [complete, { kind: "texts" }, { kind: "tex" }, { kind: 1 }, {}, { kind: "te" + hidden[0].slice(2) }].map(kindIsText).join());
report("tested read", "flagIsSet", () => flagIsSet({ get flag() { return fail(); } }));
report("tested read, no receiver", "flagIsSet", () => flagIsSet(undefined));
report("tested read, values", "flagIsSet", () => [complete, { flag: 0 }, { flag: "" }, { flag: "0" }, { flag: NaN }, { flag: null }, { flag: {} }, { flag: 0n }, {}].map(flagIsSet).join());
report("checked read", "numberOf", () => numberOf({ get n() { return fail(); } }));
report("checked read, no receiver", "numberOf", () => numberOf(null));

// Each of these is called once, from code that runs once, where no cache is worth filling.
function chainOnceFirstRead(a: any): unknown {
  const b = a.b;
  return b.c;
}
function chainOnceSecondRead(a: any): unknown {
  const b = a.b;
  return b.c;
}
// prettier-ignore
function pairOnceFirstRead(o: any): unknown {
  return {
    x: o.x,
    y: o.y,
  };
}
// prettier-ignore
function pairOnceSecondRead(o: any): unknown {
  return {
    x: o.x,
    y: o.y,
  };
}
function comparedOnce(o: any): string {
  if (o.kind === "text") return "text";
  return "other";
}
function testedOnce(o: any): string {
  if (o.flag) return "set";
  return "clear";
}
function checkedOnce(o: unknown): number | null | undefined {
  return (o as any).n as number | null | undefined;
}
function sayCaught(label: string, name: string, error: unknown): void {
  console.log("once: " + label + ":", (error as Error).constructor.name + " at line " + lineIn(name, error));
}
try {
  chainOnceFirstRead(throwsOnB);
} catch (error) {
  sayCaught("chain, first read", "chainOnceFirstRead", error);
}
try {
  chainOnceSecondRead(throwsOnC);
} catch (error) {
  sayCaught("chain, second read", "chainOnceSecondRead", error);
}
try {
  pairOnceFirstRead(throwsOnX);
} catch (error) {
  sayCaught("pair, first read", "pairOnceFirstRead", error);
}
try {
  pairOnceSecondRead(throwsOnY);
} catch (error) {
  sayCaught("pair, second read", "pairOnceSecondRead", error);
}
try {
  comparedOnce({ get kind() { return fail(); } });
} catch (error) {
  sayCaught("compared read", "comparedOnce", error);
}
try {
  testedOnce({ get flag() { return fail(); } });
} catch (error) {
  sayCaught("tested read", "testedOnce", error);
}
try {
  checkedOnce({ get n() { return fail(); } });
} catch (error) {
  sayCaught("checked read", "checkedOnce", error);
}
