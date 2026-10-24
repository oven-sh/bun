// `===`, `!==`, `==` and `!=` over every pair of operand kinds. Each operand is typed precisely, as an optional, as a literal union and as unknown; each comparison is a value and a branch condition, in hot loops and in code that runs once.
const digits = "0123456789abcdef";
function answerDigit(strict: boolean, notStrict: boolean, loose: boolean, notLoose: boolean, branches: number): string {
  const answers = (strict ? 8 : 0) + (notStrict ? 4 : 0) + (loose ? 2 : 0) + (notLoose ? 1 : 0);
  return answers === branches ? digits[answers] : "<" + answers + " " + branches + ">";
}
function join(a: string, b: string): string {
  return a + b;
}
const values: unknown[] = [0, -0, 1, 1.5, NaN, 2 ** 31, undefined, null, true, false, "", "a", "1", "é", join("a", ""), "ab", join("a", "b"), 1n, Symbol.iterator, {}, []];
const boxedAsDoubles = new Float64Array([0, -0, 1, 2 ** 31]);
for (let i = 0; i < boxedAsDoubles.length; i++) values.push(Reflect.get(boxedAsDoubles, i));

function unknownAndUnknown(a: unknown, b: unknown): string {
  return answerDigit(a === b, a !== b, a == b, a != b, (b === a ? 8 : 0) + (b !== a ? 4 : 0) + (b == a ? 2 : 0) + (b != a ? 1 : 0));
}

function withUndefined(a: unknown, b: unknown): string {
  if (a !== undefined) return "?";
  const u = a as unknown;
  if (b === undefined) return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (b === null) return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "number") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "boolean") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "string") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "bigint") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "symbol") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "object") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  return "?";
}
function withNull(a: unknown, b: unknown): string {
  if (a !== null) return "?";
  const u = a as unknown;
  if (b === undefined) return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (b === null) return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "number") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "boolean") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "string") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "bigint") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "symbol") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "object") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  return "?";
}
function withNumber(a: unknown, b: unknown): string {
  if (typeof a !== "number") return "?";
  const u = a as unknown;
  if (b === undefined) return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (b === null) return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "number") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "boolean") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "string") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "bigint") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "symbol") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "object") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  return "?";
}
function withBoolean(a: unknown, b: unknown): string {
  if (typeof a !== "boolean") return "?";
  const u = a as unknown;
  if (b === undefined) return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (b === null) return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "number") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "boolean") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "string") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "bigint") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "symbol") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "object") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  return "?";
}
function withString(a: unknown, b: unknown): string {
  if (typeof a !== "string") return "?";
  const u = a as unknown;
  if (b === undefined) return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (b === null) return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "number") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "boolean") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "string") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "bigint") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "symbol") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "object") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  return "?";
}
function withBigInt(a: unknown, b: unknown): string {
  if (typeof a !== "bigint") return "?";
  const u = a as unknown;
  if (b === undefined) return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (b === null) return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "number") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "boolean") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "string") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "bigint") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "symbol") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "object") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  return "?";
}
function withSymbol(a: unknown, b: unknown): string {
  if (typeof a !== "symbol") return "?";
  const u = a as unknown;
  if (b === undefined) return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (b === null) return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "number") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "boolean") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "string") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "bigint") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "symbol") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "object") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  return "?";
}
function withObject(a: unknown, b: unknown): string {
  if (a === null) return "?";
  if (typeof a !== "object") return "?";
  const u = a as unknown;
  if (b === undefined) return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (b === null) return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "number") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "boolean") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "string") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "bigint") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "symbol") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  if (typeof b === "object") return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0));
  return "?";
}

function numberAndNumber(a: number | undefined, b: number | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function numberAndBoolean(a: number | undefined, b: boolean | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function numberAndString(a: number | undefined, b: string | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function numberAndBigInt(a: number | undefined, b: bigint | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function numberAndSymbol(a: number | undefined, b: symbol | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function numberAndObject(a: number | undefined, b: object | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function numberAndUnknown(a: number | undefined, b: unknown): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function booleanAndNumber(a: boolean | undefined, b: number | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function booleanAndBoolean(a: boolean | undefined, b: boolean | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function booleanAndString(a: boolean | undefined, b: string | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function booleanAndBigInt(a: boolean | undefined, b: bigint | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function booleanAndSymbol(a: boolean | undefined, b: symbol | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function booleanAndObject(a: boolean | undefined, b: object | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function booleanAndUnknown(a: boolean | undefined, b: unknown): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function stringAndNumber(a: string | undefined, b: number | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function stringAndBoolean(a: string | undefined, b: boolean | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function stringAndString(a: string | undefined, b: string | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function stringAndBigInt(a: string | undefined, b: bigint | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function stringAndSymbol(a: string | undefined, b: symbol | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function stringAndObject(a: string | undefined, b: object | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function stringAndUnknown(a: string | undefined, b: unknown): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function bigIntAndNumber(a: bigint | undefined, b: number | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function bigIntAndBoolean(a: bigint | undefined, b: boolean | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function bigIntAndString(a: bigint | undefined, b: string | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function bigIntAndBigInt(a: bigint | undefined, b: bigint | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function bigIntAndSymbol(a: bigint | undefined, b: symbol | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function bigIntAndObject(a: bigint | undefined, b: object | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function bigIntAndUnknown(a: bigint | undefined, b: unknown): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function symbolAndNumber(a: symbol | undefined, b: number | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function symbolAndBoolean(a: symbol | undefined, b: boolean | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function symbolAndString(a: symbol | undefined, b: string | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function symbolAndBigInt(a: symbol | undefined, b: bigint | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function symbolAndSymbol(a: symbol | undefined, b: symbol | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function symbolAndObject(a: symbol | undefined, b: object | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function symbolAndUnknown(a: symbol | undefined, b: unknown): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function objectAndNumber(a: object | undefined, b: number | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function objectAndBoolean(a: object | undefined, b: boolean | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function objectAndString(a: object | undefined, b: string | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function objectAndBigInt(a: object | undefined, b: bigint | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function objectAndSymbol(a: object | undefined, b: symbol | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function objectAndObject(a: object | undefined, b: object | undefined): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function objectAndUnknown(a: object | undefined, b: unknown): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }

function precisely(a: unknown, b: unknown): string {
  if (a === undefined) return withUndefined(a, b);
  if (a === null) return withNull(a, b);
  if (typeof a === "number") return withNumber(a, b);
  if (typeof a === "boolean") return withBoolean(a, b);
  if (typeof a === "string") return withString(a, b);
  if (typeof a === "bigint") return withBigInt(a, b);
  if (typeof a === "symbol") return withSymbol(a, b);
  return withObject(a, b);
}

type Comparison = (a: any, b: any) => string;
const kinds = ["number", "boolean", "string", "bigint", "symbol", "object"];
const optionals: Comparison[][] = [
  [numberAndNumber, numberAndBoolean, numberAndString, numberAndBigInt, numberAndSymbol, numberAndObject, numberAndUnknown],
  [booleanAndNumber, booleanAndBoolean, booleanAndString, booleanAndBigInt, booleanAndSymbol, booleanAndObject, booleanAndUnknown],
  [stringAndNumber, stringAndBoolean, stringAndString, stringAndBigInt, stringAndSymbol, stringAndObject, stringAndUnknown],
  [bigIntAndNumber, bigIntAndBoolean, bigIntAndString, bigIntAndBigInt, bigIntAndSymbol, bigIntAndObject, bigIntAndUnknown],
  [symbolAndNumber, symbolAndBoolean, symbolAndString, symbolAndBigInt, symbolAndSymbol, symbolAndObject, symbolAndUnknown],
  [objectAndNumber, objectAndBoolean, objectAndString, objectAndBigInt, objectAndSymbol, objectAndObject, objectAndUnknown],
];
function fits(value: unknown, kind: number): boolean {
  return kind === kinds.length || value == null || typeof value === kinds[kind];
}
function table(compare: Comparison, left: unknown[], right: unknown[]): string {
  let out = "";
  for (const a of left) {
    for (const b of right) out += compare(a, b);
    out += " ";
  }
  return out;
}
function list(describe: (value: any) => string, items: unknown[]): string {
  let out = "";
  for (const item of items) out += describe(item) + " ";
  return out;
}

const integers = new Int32Array([0, 1, -1, 2 ** 31 - 1]);
const fractions = new Float64Array([0, -0, 1, 1.5, NaN, 2 ** 31 - 1]);
function integerElements(xs: Int32Array, i: number, ys: Int32Array, j: number): string { const a = xs[i], b = ys[j]; return answerDigit(a === b, a !== b, a == b, a != b, (b === a ? 8 : 0) + (b !== a ? 4 : 0) + (b == a ? 2 : 0) + (b != a ? 1 : 0)); }
function integerAndFractionElements(xs: Int32Array, i: number, ys: Float64Array, j: number): string { const a = xs[i], b = ys[j]; return answerDigit(a === b, a !== b, a == b, a != b, (b === a ? 8 : 0) + (b !== a ? 4 : 0) + (b == a ? 2 : 0) + (b != a ? 1 : 0)); }
function fractionElements(xs: Float64Array, i: number, ys: Float64Array, j: number): string { const a = xs[i], b = ys[j]; return answerDigit(a === b, a !== b, a == b, a != b, (b === a ? 8 : 0) + (b !== a ? 4 : 0) + (b == a ? 2 : 0) + (b != a ? 1 : 0)); }

type Letter = "a" | "b";
type Pair = "ab" | "cd";
function letterAndLetter(a: Letter, b: Letter): string { return answerDigit(a === b, a !== b, a == b, a != b, (b === a ? 8 : 0) + (b !== a ? 4 : 0) + (b == a ? 2 : 0) + (b != a ? 1 : 0)); }
function letterAndOtherUnion(a: Letter, b: "b" | "c"): string { return answerDigit(a === b, a !== b, a == b, a != b, (b === a ? 8 : 0) + (b !== a ? 4 : 0) + (b == a ? 2 : 0) + (b != a ? 1 : 0)); }
function letterAndString(a: Letter, b: string): string { return answerDigit(a === b, a !== b, a == b, a != b, (b === a ? 8 : 0) + (b !== a ? 4 : 0) + (b == a ? 2 : 0) + (b != a ? 1 : 0)); }
function letterAndUnknown(a: Letter, b: unknown): string { return answerDigit(a === b, a !== b, a == b, a != b, (b === a ? 8 : 0) + (b !== a ? 4 : 0) + (b == a ? 2 : 0) + (b != a ? 1 : 0)); }
function letterAndNumber(a: Letter, b: number): string { const u = a as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function pairAndPair(a: Pair, b: Pair): string { return answerDigit(a === b, a !== b, a == b, a != b, (b === a ? 8 : 0) + (b !== a ? 4 : 0) + (b == a ? 2 : 0) + (b != a ? 1 : 0)); }
function pairAndString(a: Pair, b: string): string { return answerDigit(a === b, a !== b, a == b, a != b, (b === a ? 8 : 0) + (b !== a ? 4 : 0) + (b == a ? 2 : 0) + (b != a ? 1 : 0)); }
function letterIsConstant(a: Letter): string {
  return answerDigit(a === "a", a !== "a", a == "a", a != "a", ("a" === a ? 8 : 0) + ("a" !== a ? 4 : 0) + ("a" == a ? 2 : 0) + ("a" != a ? 1 : 0))
    + answerDigit(a === "b", a !== "b", a == "b", a != "b", ("b" === a ? 8 : 0) + ("b" !== a ? 4 : 0) + ("b" == a ? 2 : 0) + ("b" != a ? 1 : 0));
}
function isTextA(text: string): boolean { return text === "a"; }
function areSameText(a: string, b: string): boolean { return a === b; }
function widenedLetters(a: Letter, b: Letter): string { return (isTextA(a) ? "1" : "0") + (areSameText(a, b) ? "1" : "0") + (areSameText("b", a) ? "1" : "0"); }
const letterValues: unknown[] = ["a", "b", String.fromCharCode(97), "xb".slice(1), undefined, null];
const otherUnionValues: unknown[] = ["b", "c", String.fromCharCode(99), undefined];
const pairValues: unknown[] = ["ab", "cd", join("a", "b"), "abcd".slice(2), undefined, null];

function numberAndItself(x: unknown): string { if (typeof x !== "number") return "?"; return answerDigit(x === x, x !== x, x == x, x != x, (x === x ? 8 : 0) + (x !== x ? 4 : 0) + (x == x ? 2 : 0) + (x != x ? 1 : 0)); }
function optionalNumberAndItself(x: number | undefined): string { return answerDigit(x === x, x !== x, x == x, x != x, (x === x ? 8 : 0) + (x !== x ? 4 : 0) + (x == x ? 2 : 0) + (x != x ? 1 : 0)); }
function unknownAndItself(x: unknown): string { return answerDigit(x === x, x !== x, x == x, x != x, (x === x ? 8 : 0) + (x !== x ? 4 : 0) + (x == x ? 2 : 0) + (x != x ? 1 : 0)); }
function elementAndItself(xs: Float64Array, i: number): string { const x = xs[i]; return answerDigit(x === x, x !== x, x == x, x != x, (x === x ? 8 : 0) + (x !== x ? 4 : 0) + (x == x ? 2 : 0) + (x != x ? 1 : 0)); }
function codeUnitAndItself(text: string, i: number): string { const x = text.charCodeAt(i); return answerDigit(x === x, x !== x, x == x, x != x, (x === x ? 8 : 0) + (x !== x ? 4 : 0) + (x == x ? 2 : 0) + (x != x ? 1 : 0)); }
function codeUnits(s: string, i: number, t: string, j: number): string { const a = s.charCodeAt(i), b = t.charCodeAt(j); return answerDigit(a === b, a !== b, a == b, a != b, (b === a ? 8 : 0) + (b !== a ? 4 : 0) + (b == a ? 2 : 0) + (b != a ? 1 : 0)); }
function codeUnitIsConstant(text: string, i: number): string { const a = text.charCodeAt(i); return answerDigit(a === 97, a !== 97, a == 97, a != 97, (97 === a ? 8 : 0) + (97 !== a ? 4 : 0) + (97 == a ? 2 : 0) + (97 != a ? 1 : 0)); }

interface Entry { id: number; next?: Entry | null; label?: string | null }
class Link { next?: Link | null; label?: string | null; constructor(public id: number) {} }
function fieldsOf(entry: Entry): string {
  const next = entry.next, label = entry.label, nothing = undefined, none = null, yes: unknown = true;
  return answerDigit(next === nothing, next !== nothing, next == nothing, next != nothing, (nothing === next ? 8 : 0) + (nothing !== next ? 4 : 0) + (nothing == next ? 2 : 0) + (nothing != next ? 1 : 0))
    + answerDigit(next === none, next !== none, next == none, next != none, (none === next ? 8 : 0) + (none !== next ? 4 : 0) + (none == next ? 2 : 0) + (none != next ? 1 : 0))
    + answerDigit(next === yes, next !== yes, next == yes, next != yes, (yes === next ? 8 : 0) + (yes !== next ? 4 : 0) + (yes == next ? 2 : 0) + (yes != next ? 1 : 0))
    + answerDigit(label === nothing, label !== nothing, label == nothing, label != nothing, (nothing === label ? 8 : 0) + (nothing !== label ? 4 : 0) + (nothing == label ? 2 : 0) + (nothing != label ? 1 : 0))
    + answerDigit(label === none, label !== none, label == none, label != none, (none === label ? 8 : 0) + (none !== label ? 4 : 0) + (none == label ? 2 : 0) + (none != label ? 1 : 0))
    + answerDigit(label === "a", label !== "a", label == "a", label != "a", ("a" === label ? 8 : 0) + ("a" !== label ? 4 : 0) + ("a" == label ? 2 : 0) + ("a" != label ? 1 : 0))
    + (entry.next === undefined ? "u" : "-") + (entry.next === null ? "n" : "-") + (undefined !== entry.label ? "-" : "u") + (null !== entry.label ? "-" : "n");
}
const lastEntry: Entry = { id: 1 };
const clearedEntry: Entry = { id: 2, next: lastEntry, label: "b" };
clearedEntry.next = undefined;
clearedEntry.label = undefined;
const deletedEntry: Entry = { id: 3, next: lastEntry, label: "b" };
delete deletedEntry.next;
delete deletedEntry.label;
const lastLink = new Link(4);
const firstLink = new Link(5);
firstLink.next = lastLink;
firstLink.label = String.fromCharCode(97);
const entries: Entry[] = [lastEntry, clearedEntry, deletedEntry, { id: 6, next: undefined, label: undefined }, { id: 7, next: null, label: null }, { id: 8, next: lastEntry, label: "a" }, firstLink, lastLink];

function int32AndUnknown(i: number, b: unknown): string { const u = (i | 0) as unknown; return answerDigit(u === b, u !== b, u == b, u != b, (b === u ? 8 : 0) + (b !== u ? 4 : 0) + (b == u ? 2 : 0) + (b != u ? 1 : 0)); }
function unknownIsInteger(b: unknown): string {
  return answerDigit(b === 1, b !== 1, b == 1, b != 1, (1 === b ? 8 : 0) + (1 !== b ? 4 : 0) + (1 == b ? 2 : 0) + (1 != b ? 1 : 0))
    + answerDigit(b === 0, b !== 0, b == 0, b != 0, (0 === b ? 8 : 0) + (0 !== b ? 4 : 0) + (0 == b ? 2 : 0) + (0 != b ? 1 : 0))
    + answerDigit(b === -1, b !== -1, b == -1, b != -1, (-1 === b ? 8 : 0) + (-1 !== b ? 4 : 0) + (-1 == b ? 2 : 0) + (-1 != b ? 1 : 0));
}
function zeroOrTextAndNumber(a: 0 | "a", b: number): string {
  const negativeZero = -0;
  return answerDigit(a === b, a !== b, a == b, a != b, (b === a ? 8 : 0) + (b !== a ? 4 : 0) + (b == a ? 2 : 0) + (b != a ? 1 : 0))
    + answerDigit(a === negativeZero, a !== negativeZero, a == negativeZero, a != negativeZero, (negativeZero === a ? 8 : 0) + (negativeZero !== a ? 4 : 0) + (negativeZero == a ? 2 : 0) + (negativeZero != a ? 1 : 0));
}
function unknownIsText(b: unknown): string {
  return answerDigit(b === "", b !== "", b == "", b != "", ("" === b ? 8 : 0) + ("" !== b ? 4 : 0) + ("" == b ? 2 : 0) + ("" != b ? 1 : 0))
    + answerDigit(b === "a", b !== "a", b == "a", b != "a", ("a" === b ? 8 : 0) + ("a" !== b ? 4 : 0) + ("a" == b ? 2 : 0) + ("a" != b ? 1 : 0))
    + answerDigit(b === "1", b !== "1", b == "1", b != "1", ("1" === b ? 8 : 0) + ("1" !== b ? 4 : 0) + ("1" == b ? 2 : 0) + ("1" != b ? 1 : 0))
    + answerDigit(b === "é", b !== "é", b == "é", b != "é", ("é" === b ? 8 : 0) + ("é" !== b ? 4 : 0) + ("é" == b ? 2 : 0) + ("é" != b ? 1 : 0))
    + answerDigit(b === "ab", b !== "ab", b == "ab", b != "ab", ("ab" === b ? 8 : 0) + ("ab" !== b ? 4 : 0) + ("ab" == b ? 2 : 0) + ("ab" != b ? 1 : 0))
    + answerDigit(b === "abcdefghijklmnopqrstuvwxyz0123456789", b !== "abcdefghijklmnopqrstuvwxyz0123456789", b == "abcdefghijklmnopqrstuvwxyz0123456789", b != "abcdefghijklmnopqrstuvwxyz0123456789", ("abcdefghijklmnopqrstuvwxyz0123456789" === b ? 8 : 0) + ("abcdefghijklmnopqrstuvwxyz0123456789" !== b ? 4 : 0) + ("abcdefghijklmnopqrstuvwxyz0123456789" == b ? 2 : 0) + ("abcdefghijklmnopqrstuvwxyz0123456789" != b ? 1 : 0));
}
function stringIsText(b: string): string {
  return answerDigit(b === "", b !== "", b == "", b != "", ("" === b ? 8 : 0) + ("" !== b ? 4 : 0) + ("" == b ? 2 : 0) + ("" != b ? 1 : 0))
    + answerDigit(b === "a", b !== "a", b == "a", b != "a", ("a" === b ? 8 : 0) + ("a" !== b ? 4 : 0) + ("a" == b ? 2 : 0) + ("a" != b ? 1 : 0))
    + answerDigit(b === "1", b !== "1", b == "1", b != "1", ("1" === b ? 8 : 0) + ("1" !== b ? 4 : 0) + ("1" == b ? 2 : 0) + ("1" != b ? 1 : 0))
    + answerDigit(b === "é", b !== "é", b == "é", b != "é", ("é" === b ? 8 : 0) + ("é" !== b ? 4 : 0) + ("é" == b ? 2 : 0) + ("é" != b ? 1 : 0))
    + answerDigit(b === "ab", b !== "ab", b == "ab", b != "ab", ("ab" === b ? 8 : 0) + ("ab" !== b ? 4 : 0) + ("ab" == b ? 2 : 0) + ("ab" != b ? 1 : 0))
    + answerDigit(b === "abcdefghijklmnopqrstuvwxyz0123456789", b !== "abcdefghijklmnopqrstuvwxyz0123456789", b == "abcdefghijklmnopqrstuvwxyz0123456789", b != "abcdefghijklmnopqrstuvwxyz0123456789", ("abcdefghijklmnopqrstuvwxyz0123456789" === b ? 8 : 0) + ("abcdefghijklmnopqrstuvwxyz0123456789" !== b ? 4 : 0) + ("abcdefghijklmnopqrstuvwxyz0123456789" == b ? 2 : 0) + ("abcdefghijklmnopqrstuvwxyz0123456789" != b ? 1 : 0));
}
const converting: unknown[] = [{ toString() { return "a"; } }, new String("ab"), ["a"], [1], join("abcdefghijklmnopqrstuvwxyz", "0123456789"), "abcdefghijklmnopqrstuvwxyz012345678x"];

function countUnknown(xs: unknown[], y: unknown): number {
  let count = 0;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] === y) count += 1;
    if (xs[i] != y) count += 100;
    count += 10000 * Number(y !== xs[i]) + 1000000 * Number(y == xs[i]);
  }
  return count;
}
function countNumbers(xs: number[], y: number): number {
  let count = 0;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] === y) count += 1;
    if (xs[i] != y) count += 100;
    count += 10000 * Number(y !== xs[i]) + 1000000 * Number(y == xs[i]);
  }
  return count;
}
function countStrings(xs: string[], y: string): number {
  let count = 0;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] === y) count += 1;
    if (xs[i] != y) count += 100;
    count += 10000 * Number(y !== xs[i]) + 1000000 * Number(y == xs[i]);
  }
  return count;
}
function countStringAmongUnknown(xs: unknown[], y: string): number {
  let count = 0;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] === y) count += 1;
    if (xs[i] != y) count += 100;
    count += 10000 * Number(y !== xs[i]) + 1000000 * Number(y == xs[i]);
  }
  return count;
}
function countLetters(xs: Letter[], y: Letter): number {
  let count = 0;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] === y) count += 1;
    if (xs[i] != y) count += 100;
    count += 10000 * Number(y !== xs[i]) + 1000000 * Number(y == xs[i]);
  }
  return count;
}
function countInt32AmongUnknown(xs: unknown[], n: number): number {
  const y = n | 0;
  let count = 0;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] === y) count += 1;
    if (xs[i] != y) count += 100;
    count += 10000 * Number(y !== xs[i]) + 1000000 * Number(y == xs[i]);
  }
  return count;
}
function countTextAmongUnknown(xs: unknown[]): number {
  let count = 0;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] === "a") count += 1;
    if ("ab" != xs[i]) count += 100;
    count += 10000 * Number("é" !== xs[i]) + 1000000 * Number(xs[i] == "1");
  }
  return count;
}
function countEqualToItself(xs: unknown[]): number {
  let count = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    if (x === x) count += 1;
    if (x != x) count += 100;
  }
  return count;
}

function once(): string {
  const one = values[2] as number, alsoOne = values[23] as number, notANumber = values[4] as number, zero = values[0] as number, negativeZero = values[1] as number;
  const text = values[15] as string, rope = values[16] as string, letter = values[11] as Letter, sameLetter = values[14] as Letter;
  const object = values[19] as object, array = values[20] as object, big = values[17] as bigint, alsoBig = BigInt(1), anything = values[16], nothing = values[6];
  return answerDigit(one === alsoOne, one !== alsoOne, one == alsoOne, one != alsoOne, (alsoOne === one ? 8 : 0) + (alsoOne !== one ? 4 : 0) + (alsoOne == one ? 2 : 0) + (alsoOne != one ? 1 : 0))
    + answerDigit(notANumber === notANumber, notANumber !== notANumber, notANumber == notANumber, notANumber != notANumber, (notANumber === notANumber ? 8 : 0) + (notANumber !== notANumber ? 4 : 0) + (notANumber == notANumber ? 2 : 0) + (notANumber != notANumber ? 1 : 0))
    + answerDigit(zero === negativeZero, zero !== negativeZero, zero == negativeZero, zero != negativeZero, (negativeZero === zero ? 8 : 0) + (negativeZero !== zero ? 4 : 0) + (negativeZero == zero ? 2 : 0) + (negativeZero != zero ? 1 : 0))
    + answerDigit(text === rope, text !== rope, text == rope, text != rope, (rope === text ? 8 : 0) + (rope !== text ? 4 : 0) + (rope == text ? 2 : 0) + (rope != text ? 1 : 0))
    + answerDigit(letter === sameLetter, letter !== sameLetter, letter == sameLetter, letter != sameLetter, (sameLetter === letter ? 8 : 0) + (sameLetter !== letter ? 4 : 0) + (sameLetter == letter ? 2 : 0) + (sameLetter != letter ? 1 : 0))
    + answerDigit(letter === text, letter !== text, letter == text, letter != text, (text === letter ? 8 : 0) + (text !== letter ? 4 : 0) + (text == letter ? 2 : 0) + (text != letter ? 1 : 0))
    + answerDigit(object === array, object !== array, object == array, object != array, (array === object ? 8 : 0) + (array !== object ? 4 : 0) + (array == object ? 2 : 0) + (array != object ? 1 : 0))
    + answerDigit(object === object, object !== object, object == object, object != object, (object === object ? 8 : 0) + (object !== object ? 4 : 0) + (object == object ? 2 : 0) + (object != object ? 1 : 0))
    + answerDigit(big === alsoBig, big !== alsoBig, big == alsoBig, big != alsoBig, (alsoBig === big ? 8 : 0) + (alsoBig !== big ? 4 : 0) + (alsoBig == big ? 2 : 0) + (alsoBig != big ? 1 : 0))
    + answerDigit(anything === text, anything !== text, anything == text, anything != text, (text === anything ? 8 : 0) + (text !== anything ? 4 : 0) + (text == anything ? 2 : 0) + (text != anything ? 1 : 0))
    + answerDigit(anything === nothing, anything !== nothing, anything == nothing, anything != nothing, (nothing === anything ? 8 : 0) + (nothing !== anything ? 4 : 0) + (nothing == anything ? 2 : 0) + (nothing != anything ? 1 : 0))
    + answerDigit(one === anything, one !== anything, one == anything, one != anything, (anything === one ? 8 : 0) + (anything !== one ? 4 : 0) + (anything == one ? 2 : 0) + (anything != one ? 1 : 0))
    + answerDigit(nothing === nothing, nothing !== nothing, nothing == nothing, nothing != nothing, (nothing === nothing ? 8 : 0) + (nothing !== nothing ? 4 : 0) + (nothing == nothing ? 2 : 0) + (nothing != nothing ? 1 : 0))
    + answerDigit(anything === "ab", anything !== "ab", anything == "ab", anything != "ab", ("ab" === anything ? 8 : 0) + ("ab" !== anything ? 4 : 0) + ("ab" == anything ? 2 : 0) + ("ab" != anything ? 1 : 0))
    + answerDigit(anything === 1, anything !== 1, anything == 1, anything != 1, (1 === anything ? 8 : 0) + (1 !== anything ? 4 : 0) + (1 == anything ? 2 : 0) + (1 != anything ? 1 : 0))
    + answerDigit(letter === "a", letter !== "a", letter == "a", letter != "a", ("a" === letter ? 8 : 0) + ("a" !== letter ? 4 : 0) + ("a" == letter ? 2 : 0) + ("a" != letter ? 1 : 0));
}

function allTables(): string[] {
  const lines: string[] = [];
  lines.push("unknown, unknown: " + table(unknownAndUnknown, values, values));
  lines.push("precise, precise: " + table(precisely, values, values));
  for (let i = 0; i < optionals.length; i++) {
    for (let j = 0; j < optionals[i].length; j++)
      lines.push(kinds[i] + "?, " + (j < kinds.length ? kinds[j] + "?" : "unknown") + ": " + table(optionals[i][j], values.filter(value => fits(value, i)), values.filter(value => fits(value, j))));
  }
  let elements = "";
  for (let i = 0; i <= integers.length; i++) for (let j = 0; j <= integers.length; j++) elements += integerElements(integers, i, integers, j);
  elements += " ";
  for (let i = 0; i <= integers.length; i++) for (let j = 0; j <= fractions.length; j++) elements += integerAndFractionElements(integers, i, fractions, j);
  elements += " ";
  for (let i = 0; i <= fractions.length; i++) for (let j = 0; j <= fractions.length; j++) elements += fractionElements(fractions, i, fractions, j);
  lines.push("elements: " + elements);
  const numbers = values.filter(value => fits(value, 0));
  const texts = values.filter(value => fits(value, 2));
  lines.push("letter, letter: " + table(letterAndLetter, letterValues, letterValues));
  lines.push("letter, other union: " + table(letterAndOtherUnion, letterValues, otherUnionValues));
  lines.push("letter, string: " + table(letterAndString, letterValues, texts));
  lines.push("letter, unknown: " + table(letterAndUnknown, letterValues, values));
  lines.push("letter, number: " + table(letterAndNumber, letterValues, numbers));
  lines.push("pair, pair: " + table(pairAndPair, pairValues, pairValues));
  lines.push("pair, string: " + table(pairAndString, pairValues, texts));
  lines.push("letter, constant: " + list(letterIsConstant, letterValues));
  lines.push("widened letters: " + table(widenedLetters, letterValues, letterValues));
  lines.push("number and itself: " + list(numberAndItself, values));
  lines.push("number? and itself: " + list(optionalNumberAndItself, numbers));
  lines.push("unknown and itself: " + list(unknownAndItself, values));
  let reads = "";
  for (let i = 0; i <= fractions.length; i++) reads += elementAndItself(fractions, i);
  reads += " ";
  for (let i = -1; i <= 2; i++) reads += codeUnitAndItself("aé", i) + codeUnitIsConstant("aé", i);
  reads += " ";
  for (let i = -1; i <= 2; i++) for (let j = -1; j <= 2; j++) reads += codeUnits("aé", i, "éa", j);
  lines.push("reads: " + reads);
  lines.push("fields: " + list(fieldsOf, entries));
  lines.push("int32, unknown: " + table(int32AndUnknown, [0, 1, -1, 2 ** 31 - 1], values));
  lines.push("unknown, integer constant: " + list(unknownIsInteger, values));
  lines.push("zero or text, number: " + table(zeroOrTextAndNumber, [0, "a", undefined], [0, -0, 1, NaN, undefined]));
  lines.push("unknown, text constant: " + list(unknownIsText, values.concat(converting)));
  lines.push("string, text constant: " + list(stringIsText, texts.concat(converting.slice(4))));
  const counts: number[] = [];
  for (const value of values) counts.push(countUnknown(values, value));
  for (const value of numbers) counts.push(countNumbers(numbers as number[], value as number));
  for (const value of texts) counts.push(countStrings(texts as string[], value as string), countStringAmongUnknown(values, value as string));
  for (const value of letterValues) counts.push(countLetters(letterValues as Letter[], value as Letter));
  for (const value of [0, 1, -1]) counts.push(countInt32AmongUnknown(values, value));
  counts.push(countTextAmongUnknown(values), countEqualToItself(values));
  lines.push("loops: " + counts.join(" "));
  return lines;
}

const first = allTables();
console.log(first.join("\n"));
for (let round = 0; round < 20; round++) {
  const again = allTables();
  for (let i = 0; i < first.length; i++) if (again[i] !== first[i]) console.log("round " + round + " changed line " + i);
}
console.log("once: " + once());
