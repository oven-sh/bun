// The programs of language that are mostly a loop written out: thousands of fields, variables or functions that differ in a number. And those that are another program without its types.
import { family, programsOf, text, untypedTwins } from "../generate";

export const programs = () =>
  programsOf({
    ...family(
      `a-built-in-that-has-been-through-native-code-is-changed-by-reflect-define-property.mjs	defineProperty": (object, name) => Reflect.defineProperty(object, name, { value: replacement(name), configurable: true, writable: true }
a-built-in-that-has-been-through-native-code-is-changed-by-reflect-delete-property.mjs	deleteProperty": (object, name) => Reflect.deleteProperty(object, name
a-built-in-that-has-been-through-native-code-is-changed-by-reflect-set.mjs	set": (object, name) => Reflect.set(object, name, replacement(name)`,
      a => `// The program changes a member of a built-in prototype that it has found under a computed name and that has been through native code. No other statement of the program changes that prototype.
// The change arrives, and compiled code sees it.
const state = { hits: 0 };
function twice(read) {
  let sum = 0;
  for (let round = 0; round < 2; round++) sum += read();
  return sum;
}
function replacement(name) {
  return function replaced() {
    state.hits = state.hits + "h";
    return name + "!";
  };
}
const ways = {
  "Reflect.${a}),
};
const table = [["DisposableStack", "use"], ["DisposableStack", "adopt"], ["DisposableStack", "defer"], ["DisposableStack", "move"], ["DisposableStack", "dispose"], ["AsyncDisposableStack", "use"], ["AsyncDisposableStack", "adopt"], ["AsyncDisposableStack", "defer"], ["AsyncDisposableStack", "move"]];
const stack = new DisposableStack();
const asyncStack = new AsyncDisposableStack();
const uses = [() => stack.use(), () => stack.adopt(), () => stack.defer(), () => stack.move(), () => stack.dispose(), () => asyncStack.use(), () => asyncStack.adopt(), () => asyncStack.defer(), () => asyncStack.move()];
let index = 0;
for (const [way, change] of Object.entries(ways)) {
  const [holder, name] = table[index];
  const object = globalThis[holder].prototype;
  Reflect.get(object, "mark", object);
  let verdict;
  try {
    verdict = String(change(object, name));
  } catch (error) {
    verdict = "refused (" + error.constructor.name + ")";
  }
  let answer;
  try {
    answer = twice(uses[index]);
  } catch (error) {
    answer = error.constructor.name;
  }
  console.log(way + ":", name, verdict, answer, twice(() => state.hits));
  index++;
}
`,
    ),
    ...untypedTwins("language", "js", ["strict-equality-any-values"]),
    "operators-inside-loops.json": `{ "skipInShell": "one function of many thousand blocks: where the back end is validated after each phase, simplifyCFG of B3 and of Air look at every block once for every block, and the build takes over five minutes", "skipInVariant": { "validate-back-end": "one function of many thousand blocks: where the back end is validated after each phase, simplifyCFG of B3 and of Air look at every block once for every block, and the build takes over five minutes" } }
`,
    "operators-inside-loops.ts": text(
      `// Binary operators, \`===\`, truthiness, string conversion and comparisons with string literals in code inside loops.
declare const console: { log(...values: unknown[]): void };
function rope(a: string, b: string): string { return a + b; }
function part(s: string): string { return s.substring(1, s.length - 1); }
function wide(s: string): string { return (s + "Ā").slice(0, -1); }
const withValueOf: any = { valueOf() { return 42; } };
const withToString: any = { toString() { return "told"; } };
const withPrimitive: any = { [Symbol.toPrimitive](hint: string) { return hint === "number" ? 3 : hint === "string" ? "str" : "def"; } };
const throws: any = { valueOf() { throw new RangeError("asked"); }, toString() { throw new RangeError("asked for a string"); } };
const symbol: any = Symbol("s");
const f: any = Object.assign(function named() { }, { toString() { return "fn"; } });
const V: any[] = [0, -0, 1, -1, 0.5, 1e21, 1e-7, NaN, Infinity, -Infinity, 2147483647, 2147483648, -2147483649, 9007199254740993, "", "a", "7", " 12 ", "abc", "0x10", rope("ab", "c"), rope("", "7"), part("xabcx"), wide("abc"), "\\u0100", rope("\\u0100", "b"), rope(rope("a text of thirty", "-two "), rope("charac", "ters!")), true, false, null, undefined, 0n, 1n, -5n, 12345678901234567890n, {}, [], [7], [1, 2], withValueOf, withToString, withPrimitive, throws, symbol, f];
const N: number[] = [0, -0, 1, -1, 0.5, 1e21, 1e-7, NaN, Infinity, -Infinity, 2147483647, 2147483648, -2147483649, 9007199254740993];
const S: string[] = ["", "a", "7", " 12 ", "abc", "0x10", rope("ab", "c"), rope("", "7"), part("xabcx"), wide("abc"), "\\u0100", rope("\\u0100", "b"), rope(rope("a text of thirty", "-two "), rope("charac", "ters!"))];
const U: (string | number | boolean | null | undefined)[] = [0, -0, 1, -1, 0.5, 1e21, 1e-7, NaN, Infinity, -Infinity, 2147483647, 2147483648, -2147483649, 9007199254740993, "", "a", "7", " 12 ", "abc", "0x10", rope("ab", "c"), rope("", "7"), part("xabcx"), wide("abc"), "\\u0100", rope("\\u0100", "b"), rope(rope("a text of thirty", "-two "), rope("charac", "ters!")), true, false, null, undefined];
const W: (string | number | null)[] = [0, -0, 1, -1, 0.5, 1e21, 1e-7, NaN, Infinity, -Infinity, 2147483647, 2147483648, -2147483649, 9007199254740993, "", "a", "7", " 12 ", "abc", "0x10", rope("ab", "c"), rope("", "7"), part("xabcx"), wide("abc"), "\\u0100", rope("\\u0100", "b"), rope(rope("a text of thirty", "-two "), rope("charac", "ters!")), null];
const X: (string | number | undefined)[] = [0, -0, 1, -1, 0.5, 1e21, 1e-7, NaN, Infinity, -Infinity, 2147483647, 2147483648, -2147483649, 9007199254740993, "", "a", "7", " 12 ", "abc", "0x10", rope("ab", "c"), rope("", "7"), part("xabcx"), wide("abc"), "\\u0100", rope("\\u0100", "b"), rope(rope("a text of thirty", "-two "), rope("charac", "ters!")), undefined];
const Y: (string | null | undefined)[] = ["", "a", "7", " 12 ", "abc", "0x10", rope("ab", "c"), rope("", "7"), part("xabcx"), wide("abc"), "\\u0100", rope("\\u0100", "b"), rope(rope("a text of thirty", "-two "), rope("charac", "ters!")), null, undefined];
function show(v: any): string { return typeof v === "bigint" ? String(v) + "n" : typeof v === "string" ? JSON.stringify(v) : typeof v === "symbol" ? "symbol" : Object.is(v, -0) ? "-0" : String(v); }
function t(op: (a: any, b: any) => any, a: any, b: any): string { try { return show(op(a, b)); } catch (e: any) { return e.name + ": " + e.message; } }
function u(op: (a: any) => any, a: any): string { try { return show(op(a)); } catch (e: any) { return e.name + ": " + e.message; } }
let spin = 0;
function add(a: any, b: any): any { for (let i = 0; i < 2; i++) spin = (spin + i) | 0; return a + b; }
function sub(a: any, b: any): any { for (let i = 0; i < 2; i++) spin = (spin + i) | 0; return a - b; }
function mul(a: any, b: any): any { for (let i = 0; i < 2; i++) spin = (spin + i) | 0; return a * b; }
function div(a: any, b: any): any { for (let i = 0; i < 2; i++) spin = (spin + i) | 0; return a / b; }
function mod(a: any, b: any): any { for (let i = 0; i < 2; i++) spin = (spin + i) | 0; return a % b; }
function pow(a: any, b: any): any { for (let i = 0; i < 2; i++) spin = (spin + i) | 0; return a ** b; }
function and(a: any, b: any): any { for (let i = 0; i < 2; i++) spin = (spin + i) | 0; return a & b; }
function or(a: any, b: any): any { for (let i = 0; i < 2; i++) spin = (spin + i) | 0; return a | b; }
function xor(a: any, b: any): any { for (let i = 0; i < 2; i++) spin = (spin + i) | 0; return a ^ b; }
function shl(a: any, b: any): any { for (let i = 0; i < 2; i++) spin = (spin + i) | 0; return a << b; }
function shr(a: any, b: any): any { for (let i = 0; i < 2; i++) spin = (spin + i) | 0; return a >> b; }
function ushr(a: any, b: any): any { for (let i = 0; i < 2; i++) spin = (spin + i) | 0; return a >>> b; }
function same(a: any, b: any): boolean { for (let i = 0; i < 2; i++) spin = (spin + i) | 0; return a === b; }
function other(a: any, b: any): boolean { for (let i = 0; i < 2; i++) spin = (spin + i) | 0; return a !== b; }
function sameUnion(a: string | number | null, b: string | number | undefined): boolean { for (let i = 0; i < 2; i++) spin = (spin + i) | 0; return a === b; }
function truth(a: any): string { for (let i = 0; i < 2; i++) spin = (spin + i) | 0; return a ? "yes" : "no"; }
function not(a: any): boolean { for (let i = 0; i < 2; i++) spin = (spin + i) | 0; return !a; }
function truthUnion(a: string | number | boolean | null | undefined): number { for (let i = 0; i < 2; i++) spin = (spin + i) | 0; return a ? 1 : 0; }
function text(a: any): string { for (let i = 0; i < 2; i++) spin = (spin + i) | 0; return \`<\${a}>\`; }
function textOfNumber(a: number): string { for (let i = 0; i < 2; i++) spin = (spin + i) | 0; return \`\${a}\`; }
function textOfInteger(a: number): string { for (let i = 0; i < 2; i++) spin = (spin + i) | 0; return \`\${a | 0}:\${(a | 0) + 1}\`; }
function textOfUnion(a: string | number | boolean | null | undefined): string { for (let i = 0; i < 2; i++) spin = (spin + i) | 0; return "" + a; }
function addToText(a: string, b: any): string { for (let i = 0; i < 2; i++) spin = (spin + i) | 0; return a + b; }
function addNumberOrText(a: number | string | null, b: number | string | undefined): number | string { for (let i = 0; i < 2; i++) spin = (spin + i) | 0; return (a as any) + (b as any); }
function one(s: any): string { for (let i = 0; i < 2; i++) spin = (spin + i) | 0; if (s === "abc") return "is abc"; return "no"; }
function ladder(s: any): string { for (let i = 0; i < 2; i++) spin = (spin + i) | 0;
  if (s === "a") return "a"; else if (s === "7") return "seven"; else if (s === "abc") return "abc"; else if (s === "abd") return "abd"; else if (s === "Ā") return "A-macron";
  else if (s === "told") return "told"; else if (s === "a text of thirty-two characters!") return "32"; else if (s === "") return "empty";
  return "none";
}
function ladderOfString(s: string): number { for (let i = 0; i < 2; i++) spin = (spin + i) | 0;
  switch (s) { case "a": return 1; case "7": return 2; case "abc": return 3; case "abd": return 4; case " 12 ": return 5; case "0x10": return 6; case "Ā": return 7; case "Āb": return 8; default: return 0; }
}
function ladderOrNil(s: string | null | undefined): number { for (let i = 0; i < 2; i++) spin = (spin + i) | 0; if (s === "abc") return 1; if (s === "7") return 2; if (s === "ab") return 3; return 0; }
`,
      [
        45,
        n =>
          `console.log("add", ${n}, t(add, V[${n}], V[0]), t(add, V[${n}], V[1]), t(add, V[${n}], V[2]), t(add, V[${n}], V[4]), t(add, V[${n}], V[7]), t(add, V[${n}], V[10]), t(add, V[${n}], V[16]), t(add, V[${n}], V[18]), t(add, V[${n}], V[20]), t(add, V[${n}], V[23]), t(add, V[${n}], V[27]), t(add, V[${n}], V[29]), t(add, V[${n}], V[30]), t(add, V[${n}], V[32]), t(add, V[${n}], V[33]), t(add, V[${n}], V[35]), t(add, V[${n}], V[37]), t(add, V[${n}], V[39]), t(add, V[${n}], V[40]), t(add, V[${n}], V[41]), t(add, V[${n}], V[42]), t(add, V[${n}], V[43]));`,
      ],
      [
        45,
        n =>
          `console.log("sub", ${n}, t(sub, V[${n}], V[0]), t(sub, V[${n}], V[1]), t(sub, V[${n}], V[2]), t(sub, V[${n}], V[4]), t(sub, V[${n}], V[7]), t(sub, V[${n}], V[10]), t(sub, V[${n}], V[16]), t(sub, V[${n}], V[18]), t(sub, V[${n}], V[20]), t(sub, V[${n}], V[23]), t(sub, V[${n}], V[27]), t(sub, V[${n}], V[29]), t(sub, V[${n}], V[30]), t(sub, V[${n}], V[32]), t(sub, V[${n}], V[33]), t(sub, V[${n}], V[35]), t(sub, V[${n}], V[37]), t(sub, V[${n}], V[39]), t(sub, V[${n}], V[40]), t(sub, V[${n}], V[41]), t(sub, V[${n}], V[42]), t(sub, V[${n}], V[43]));`,
      ],
      [
        45,
        n =>
          `console.log("mul", ${n}, t(mul, V[${n}], V[0]), t(mul, V[${n}], V[1]), t(mul, V[${n}], V[2]), t(mul, V[${n}], V[4]), t(mul, V[${n}], V[7]), t(mul, V[${n}], V[10]), t(mul, V[${n}], V[16]), t(mul, V[${n}], V[18]), t(mul, V[${n}], V[20]), t(mul, V[${n}], V[23]), t(mul, V[${n}], V[27]), t(mul, V[${n}], V[29]), t(mul, V[${n}], V[30]), t(mul, V[${n}], V[32]), t(mul, V[${n}], V[33]), t(mul, V[${n}], V[35]), t(mul, V[${n}], V[37]), t(mul, V[${n}], V[39]), t(mul, V[${n}], V[40]), t(mul, V[${n}], V[41]), t(mul, V[${n}], V[42]), t(mul, V[${n}], V[43]));`,
      ],
      [
        45,
        n =>
          `console.log("div", ${n}, t(div, V[${n}], V[0]), t(div, V[${n}], V[1]), t(div, V[${n}], V[2]), t(div, V[${n}], V[4]), t(div, V[${n}], V[7]), t(div, V[${n}], V[10]), t(div, V[${n}], V[16]), t(div, V[${n}], V[18]), t(div, V[${n}], V[20]), t(div, V[${n}], V[23]), t(div, V[${n}], V[27]), t(div, V[${n}], V[29]), t(div, V[${n}], V[30]), t(div, V[${n}], V[32]), t(div, V[${n}], V[33]), t(div, V[${n}], V[35]), t(div, V[${n}], V[37]), t(div, V[${n}], V[39]), t(div, V[${n}], V[40]), t(div, V[${n}], V[41]), t(div, V[${n}], V[42]), t(div, V[${n}], V[43]));`,
      ],
      [
        45,
        n =>
          `console.log("mod", ${n}, t(mod, V[${n}], V[0]), t(mod, V[${n}], V[1]), t(mod, V[${n}], V[2]), t(mod, V[${n}], V[4]), t(mod, V[${n}], V[7]), t(mod, V[${n}], V[10]), t(mod, V[${n}], V[16]), t(mod, V[${n}], V[18]), t(mod, V[${n}], V[20]), t(mod, V[${n}], V[23]), t(mod, V[${n}], V[27]), t(mod, V[${n}], V[29]), t(mod, V[${n}], V[30]), t(mod, V[${n}], V[32]), t(mod, V[${n}], V[33]), t(mod, V[${n}], V[35]), t(mod, V[${n}], V[37]), t(mod, V[${n}], V[39]), t(mod, V[${n}], V[40]), t(mod, V[${n}], V[41]), t(mod, V[${n}], V[42]), t(mod, V[${n}], V[43]));`,
      ],
      [
        45,
        n =>
          `console.log("pow", ${n}, t(pow, V[${n}], V[0]), t(pow, V[${n}], V[1]), t(pow, V[${n}], V[2]), t(pow, V[${n}], V[4]), t(pow, V[${n}], V[7]), t(pow, V[${n}], V[10]), t(pow, V[${n}], V[16]), t(pow, V[${n}], V[18]), t(pow, V[${n}], V[20]), t(pow, V[${n}], V[23]), t(pow, V[${n}], V[27]), t(pow, V[${n}], V[29]), t(pow, V[${n}], V[30]), t(pow, V[${n}], V[32]), t(pow, V[${n}], V[33]), t(pow, V[${n}], V[35]), t(pow, V[${n}], V[37]), t(pow, V[${n}], V[39]), t(pow, V[${n}], V[40]), t(pow, V[${n}], V[41]), t(pow, V[${n}], V[42]), t(pow, V[${n}], V[43]));`,
      ],
      [
        45,
        n =>
          `console.log("and", ${n}, t(and, V[${n}], V[0]), t(and, V[${n}], V[1]), t(and, V[${n}], V[2]), t(and, V[${n}], V[4]), t(and, V[${n}], V[7]), t(and, V[${n}], V[10]), t(and, V[${n}], V[16]), t(and, V[${n}], V[18]), t(and, V[${n}], V[20]), t(and, V[${n}], V[23]), t(and, V[${n}], V[27]), t(and, V[${n}], V[29]), t(and, V[${n}], V[30]), t(and, V[${n}], V[32]), t(and, V[${n}], V[33]), t(and, V[${n}], V[35]), t(and, V[${n}], V[37]), t(and, V[${n}], V[39]), t(and, V[${n}], V[40]), t(and, V[${n}], V[41]), t(and, V[${n}], V[42]), t(and, V[${n}], V[43]));`,
      ],
      [
        45,
        n =>
          `console.log("or", ${n}, t(or, V[${n}], V[0]), t(or, V[${n}], V[1]), t(or, V[${n}], V[2]), t(or, V[${n}], V[4]), t(or, V[${n}], V[7]), t(or, V[${n}], V[10]), t(or, V[${n}], V[16]), t(or, V[${n}], V[18]), t(or, V[${n}], V[20]), t(or, V[${n}], V[23]), t(or, V[${n}], V[27]), t(or, V[${n}], V[29]), t(or, V[${n}], V[30]), t(or, V[${n}], V[32]), t(or, V[${n}], V[33]), t(or, V[${n}], V[35]), t(or, V[${n}], V[37]), t(or, V[${n}], V[39]), t(or, V[${n}], V[40]), t(or, V[${n}], V[41]), t(or, V[${n}], V[42]), t(or, V[${n}], V[43]));`,
      ],
      [
        45,
        n =>
          `console.log("xor", ${n}, t(xor, V[${n}], V[0]), t(xor, V[${n}], V[1]), t(xor, V[${n}], V[2]), t(xor, V[${n}], V[4]), t(xor, V[${n}], V[7]), t(xor, V[${n}], V[10]), t(xor, V[${n}], V[16]), t(xor, V[${n}], V[18]), t(xor, V[${n}], V[20]), t(xor, V[${n}], V[23]), t(xor, V[${n}], V[27]), t(xor, V[${n}], V[29]), t(xor, V[${n}], V[30]), t(xor, V[${n}], V[32]), t(xor, V[${n}], V[33]), t(xor, V[${n}], V[35]), t(xor, V[${n}], V[37]), t(xor, V[${n}], V[39]), t(xor, V[${n}], V[40]), t(xor, V[${n}], V[41]), t(xor, V[${n}], V[42]), t(xor, V[${n}], V[43]));`,
      ],
      [
        45,
        n =>
          `console.log("shl", ${n}, t(shl, V[${n}], V[0]), t(shl, V[${n}], V[1]), t(shl, V[${n}], V[2]), t(shl, V[${n}], V[4]), t(shl, V[${n}], V[7]), t(shl, V[${n}], V[10]), t(shl, V[${n}], V[16]), t(shl, V[${n}], V[18]), t(shl, V[${n}], V[20]), t(shl, V[${n}], V[23]), t(shl, V[${n}], V[27]), t(shl, V[${n}], V[29]), t(shl, V[${n}], V[30]), t(shl, V[${n}], V[32]), t(shl, V[${n}], V[33]), t(shl, V[${n}], V[35]), t(shl, V[${n}], V[37]), t(shl, V[${n}], V[39]), t(shl, V[${n}], V[40]), t(shl, V[${n}], V[41]), t(shl, V[${n}], V[42]), t(shl, V[${n}], V[43]));`,
      ],
      [
        45,
        n =>
          `console.log("shr", ${n}, t(shr, V[${n}], V[0]), t(shr, V[${n}], V[1]), t(shr, V[${n}], V[2]), t(shr, V[${n}], V[4]), t(shr, V[${n}], V[7]), t(shr, V[${n}], V[10]), t(shr, V[${n}], V[16]), t(shr, V[${n}], V[18]), t(shr, V[${n}], V[20]), t(shr, V[${n}], V[23]), t(shr, V[${n}], V[27]), t(shr, V[${n}], V[29]), t(shr, V[${n}], V[30]), t(shr, V[${n}], V[32]), t(shr, V[${n}], V[33]), t(shr, V[${n}], V[35]), t(shr, V[${n}], V[37]), t(shr, V[${n}], V[39]), t(shr, V[${n}], V[40]), t(shr, V[${n}], V[41]), t(shr, V[${n}], V[42]), t(shr, V[${n}], V[43]));`,
      ],
      [
        45,
        n =>
          `console.log("ushr", ${n}, t(ushr, V[${n}], V[0]), t(ushr, V[${n}], V[1]), t(ushr, V[${n}], V[2]), t(ushr, V[${n}], V[4]), t(ushr, V[${n}], V[7]), t(ushr, V[${n}], V[10]), t(ushr, V[${n}], V[16]), t(ushr, V[${n}], V[18]), t(ushr, V[${n}], V[20]), t(ushr, V[${n}], V[23]), t(ushr, V[${n}], V[27]), t(ushr, V[${n}], V[29]), t(ushr, V[${n}], V[30]), t(ushr, V[${n}], V[32]), t(ushr, V[${n}], V[33]), t(ushr, V[${n}], V[35]), t(ushr, V[${n}], V[37]), t(ushr, V[${n}], V[39]), t(ushr, V[${n}], V[40]), t(ushr, V[${n}], V[41]), t(ushr, V[${n}], V[42]), t(ushr, V[${n}], V[43]));`,
      ],
      [
        45,
        n =>
          `console.log("same", ${n}, t(same, V[${n}], V[0]), t(same, V[${n}], V[1]), t(same, V[${n}], V[2]), t(same, V[${n}], V[4]), t(same, V[${n}], V[7]), t(same, V[${n}], V[10]), t(same, V[${n}], V[16]), t(same, V[${n}], V[18]), t(same, V[${n}], V[20]), t(same, V[${n}], V[23]), t(same, V[${n}], V[27]), t(same, V[${n}], V[29]), t(same, V[${n}], V[30]), t(same, V[${n}], V[32]), t(same, V[${n}], V[33]), t(same, V[${n}], V[35]), t(same, V[${n}], V[37]), t(same, V[${n}], V[39]), t(same, V[${n}], V[40]), t(same, V[${n}], V[41]), t(same, V[${n}], V[42]), t(same, V[${n}], V[43]));`,
      ],
      [
        45,
        n =>
          `console.log("other", ${n}, t(other, V[${n}], V[0]), t(other, V[${n}], V[1]), t(other, V[${n}], V[2]), t(other, V[${n}], V[4]), t(other, V[${n}], V[7]), t(other, V[${n}], V[10]), t(other, V[${n}], V[16]), t(other, V[${n}], V[18]), t(other, V[${n}], V[20]), t(other, V[${n}], V[23]), t(other, V[${n}], V[27]), t(other, V[${n}], V[29]), t(other, V[${n}], V[30]), t(other, V[${n}], V[32]), t(other, V[${n}], V[33]), t(other, V[${n}], V[35]), t(other, V[${n}], V[37]), t(other, V[${n}], V[39]), t(other, V[${n}], V[40]), t(other, V[${n}], V[41]), t(other, V[${n}], V[42]), t(other, V[${n}], V[43]));`,
      ],
      `console.log("truth", u(truth, V[0]), u(truth, V[1]), u(truth, V[2]), u(truth, V[3]), u(truth, V[4]), u(truth, V[5]), u(truth, V[6]), u(truth, V[7]), u(truth, V[8]), u(truth, V[9]), u(truth, V[10]), u(truth, V[11]), u(truth, V[12]), u(truth, V[13]), u(truth, V[14]), u(truth, V[15]), u(truth, V[16]), u(truth, V[17]), u(truth, V[18]), u(truth, V[19]), u(truth, V[20]), u(truth, V[21]), u(truth, V[22]), u(truth, V[23]), u(truth, V[24]), u(truth, V[25]), u(truth, V[26]), u(truth, V[27]), u(truth, V[28]), u(truth, V[29]), u(truth, V[30]), u(truth, V[31]), u(truth, V[32]), u(truth, V[33]), u(truth, V[34]), u(truth, V[35]), u(truth, V[36]), u(truth, V[37]), u(truth, V[38]), u(truth, V[39]), u(truth, V[40]), u(truth, V[41]), u(truth, V[42]), u(truth, V[43]), u(truth, V[44]));
console.log("not", u(not, V[0]), u(not, V[1]), u(not, V[2]), u(not, V[3]), u(not, V[4]), u(not, V[5]), u(not, V[6]), u(not, V[7]), u(not, V[8]), u(not, V[9]), u(not, V[10]), u(not, V[11]), u(not, V[12]), u(not, V[13]), u(not, V[14]), u(not, V[15]), u(not, V[16]), u(not, V[17]), u(not, V[18]), u(not, V[19]), u(not, V[20]), u(not, V[21]), u(not, V[22]), u(not, V[23]), u(not, V[24]), u(not, V[25]), u(not, V[26]), u(not, V[27]), u(not, V[28]), u(not, V[29]), u(not, V[30]), u(not, V[31]), u(not, V[32]), u(not, V[33]), u(not, V[34]), u(not, V[35]), u(not, V[36]), u(not, V[37]), u(not, V[38]), u(not, V[39]), u(not, V[40]), u(not, V[41]), u(not, V[42]), u(not, V[43]), u(not, V[44]));
console.log("text", u(text, V[0]), u(text, V[1]), u(text, V[2]), u(text, V[3]), u(text, V[4]), u(text, V[5]), u(text, V[6]), u(text, V[7]), u(text, V[8]), u(text, V[9]), u(text, V[10]), u(text, V[11]), u(text, V[12]), u(text, V[13]), u(text, V[14]), u(text, V[15]), u(text, V[16]), u(text, V[17]), u(text, V[18]), u(text, V[19]), u(text, V[20]), u(text, V[21]), u(text, V[22]), u(text, V[23]), u(text, V[24]), u(text, V[25]), u(text, V[26]), u(text, V[27]), u(text, V[28]), u(text, V[29]), u(text, V[30]), u(text, V[31]), u(text, V[32]), u(text, V[33]), u(text, V[34]), u(text, V[35]), u(text, V[36]), u(text, V[37]), u(text, V[38]), u(text, V[39]), u(text, V[40]), u(text, V[41]), u(text, V[42]), u(text, V[43]), u(text, V[44]));
console.log("one", u(one, V[0]), u(one, V[1]), u(one, V[2]), u(one, V[3]), u(one, V[4]), u(one, V[5]), u(one, V[6]), u(one, V[7]), u(one, V[8]), u(one, V[9]), u(one, V[10]), u(one, V[11]), u(one, V[12]), u(one, V[13]), u(one, V[14]), u(one, V[15]), u(one, V[16]), u(one, V[17]), u(one, V[18]), u(one, V[19]), u(one, V[20]), u(one, V[21]), u(one, V[22]), u(one, V[23]), u(one, V[24]), u(one, V[25]), u(one, V[26]), u(one, V[27]), u(one, V[28]), u(one, V[29]), u(one, V[30]), u(one, V[31]), u(one, V[32]), u(one, V[33]), u(one, V[34]), u(one, V[35]), u(one, V[36]), u(one, V[37]), u(one, V[38]), u(one, V[39]), u(one, V[40]), u(one, V[41]), u(one, V[42]), u(one, V[43]), u(one, V[44]));
console.log("ladder", u(ladder, V[0]), u(ladder, V[1]), u(ladder, V[2]), u(ladder, V[3]), u(ladder, V[4]), u(ladder, V[5]), u(ladder, V[6]), u(ladder, V[7]), u(ladder, V[8]), u(ladder, V[9]), u(ladder, V[10]), u(ladder, V[11]), u(ladder, V[12]), u(ladder, V[13]), u(ladder, V[14]), u(ladder, V[15]), u(ladder, V[16]), u(ladder, V[17]), u(ladder, V[18]), u(ladder, V[19]), u(ladder, V[20]), u(ladder, V[21]), u(ladder, V[22]), u(ladder, V[23]), u(ladder, V[24]), u(ladder, V[25]), u(ladder, V[26]), u(ladder, V[27]), u(ladder, V[28]), u(ladder, V[29]), u(ladder, V[30]), u(ladder, V[31]), u(ladder, V[32]), u(ladder, V[33]), u(ladder, V[34]), u(ladder, V[35]), u(ladder, V[36]), u(ladder, V[37]), u(ladder, V[38]), u(ladder, V[39]), u(ladder, V[40]), u(ladder, V[41]), u(ladder, V[42]), u(ladder, V[43]), u(ladder, V[44]));
console.log("ladderOfString", ladderOfString(S[0]!), ladderOfString(S[1]!), ladderOfString(S[2]!), ladderOfString(S[3]!), ladderOfString(S[4]!), ladderOfString(S[5]!), ladderOfString(S[6]!), ladderOfString(S[7]!), ladderOfString(S[8]!), ladderOfString(S[9]!), ladderOfString(S[10]!), ladderOfString(S[11]!), ladderOfString(S[12]!));
console.log("ladderOrNil", ladderOrNil(Y[0]), ladderOrNil(Y[1]), ladderOrNil(Y[2]), ladderOrNil(Y[3]), ladderOrNil(Y[4]), ladderOrNil(Y[5]), ladderOrNil(Y[6]), ladderOrNil(Y[7]), ladderOrNil(Y[8]), ladderOrNil(Y[9]), ladderOrNil(Y[10]), ladderOrNil(Y[11]), ladderOrNil(Y[12]), ladderOrNil(Y[13]), ladderOrNil(Y[14]));
console.log("textOfNumber", textOfNumber(N[0]!), textOfNumber(N[1]!), textOfNumber(N[2]!), textOfNumber(N[3]!), textOfNumber(N[4]!), textOfNumber(N[5]!), textOfNumber(N[6]!), textOfNumber(N[7]!), textOfNumber(N[8]!), textOfNumber(N[9]!), textOfNumber(N[10]!), textOfNumber(N[11]!), textOfNumber(N[12]!), textOfNumber(N[13]!));
console.log("textOfInteger", textOfInteger(N[0]!), textOfInteger(N[1]!), textOfInteger(N[2]!), textOfInteger(N[3]!), textOfInteger(N[4]!), textOfInteger(N[5]!), textOfInteger(N[6]!), textOfInteger(N[7]!), textOfInteger(N[8]!), textOfInteger(N[9]!), textOfInteger(N[10]!), textOfInteger(N[11]!), textOfInteger(N[12]!), textOfInteger(N[13]!));
console.log("textOfUnion", textOfUnion(U[0]), textOfUnion(U[1]), textOfUnion(U[2]), textOfUnion(U[3]), textOfUnion(U[4]), textOfUnion(U[5]), textOfUnion(U[6]), textOfUnion(U[7]), textOfUnion(U[8]), textOfUnion(U[9]), textOfUnion(U[10]), textOfUnion(U[11]), textOfUnion(U[12]), textOfUnion(U[13]), textOfUnion(U[14]), textOfUnion(U[15]), textOfUnion(U[16]), textOfUnion(U[17]), textOfUnion(U[18]), textOfUnion(U[19]), textOfUnion(U[20]), textOfUnion(U[21]), textOfUnion(U[22]), textOfUnion(U[23]), textOfUnion(U[24]), textOfUnion(U[25]), textOfUnion(U[26]), textOfUnion(U[27]), textOfUnion(U[28]), textOfUnion(U[29]), textOfUnion(U[30]));
console.log("truthUnion", truthUnion(U[0]), truthUnion(U[1]), truthUnion(U[2]), truthUnion(U[3]), truthUnion(U[4]), truthUnion(U[5]), truthUnion(U[6]), truthUnion(U[7]), truthUnion(U[8]), truthUnion(U[9]), truthUnion(U[10]), truthUnion(U[11]), truthUnion(U[12]), truthUnion(U[13]), truthUnion(U[14]), truthUnion(U[15]), truthUnion(U[16]), truthUnion(U[17]), truthUnion(U[18]), truthUnion(U[19]), truthUnion(U[20]), truthUnion(U[21]), truthUnion(U[22]), truthUnion(U[23]), truthUnion(U[24]), truthUnion(U[25]), truthUnion(U[26]), truthUnion(U[27]), truthUnion(U[28]), truthUnion(U[29]), truthUnion(U[30]));`,
      [
        13,
        n =>
          `console.log("addToText", ${n}, t(addToText, S[${n}], V[0]), t(addToText, S[${n}], V[1]), t(addToText, S[${n}], V[2]), t(addToText, S[${n}], V[3]), t(addToText, S[${n}], V[4]), t(addToText, S[${n}], V[5]), t(addToText, S[${n}], V[6]), t(addToText, S[${n}], V[7]), t(addToText, S[${n}], V[8]), t(addToText, S[${n}], V[9]), t(addToText, S[${n}], V[10]), t(addToText, S[${n}], V[11]), t(addToText, S[${n}], V[12]), t(addToText, S[${n}], V[13]), t(addToText, S[${n}], V[14]), t(addToText, S[${n}], V[15]), t(addToText, S[${n}], V[16]), t(addToText, S[${n}], V[17]), t(addToText, S[${n}], V[18]), t(addToText, S[${n}], V[19]), t(addToText, S[${n}], V[20]), t(addToText, S[${n}], V[21]), t(addToText, S[${n}], V[22]), t(addToText, S[${n}], V[23]), t(addToText, S[${n}], V[24]), t(addToText, S[${n}], V[25]), t(addToText, S[${n}], V[26]), t(addToText, S[${n}], V[27]), t(addToText, S[${n}], V[28]), t(addToText, S[${n}], V[29]), t(addToText, S[${n}], V[30]), t(addToText, S[${n}], V[31]), t(addToText, S[${n}], V[32]), t(addToText, S[${n}], V[33]), t(addToText, S[${n}], V[34]), t(addToText, S[${n}], V[35]), t(addToText, S[${n}], V[36]), t(addToText, S[${n}], V[37]), t(addToText, S[${n}], V[38]), t(addToText, S[${n}], V[39]), t(addToText, S[${n}], V[40]), t(addToText, S[${n}], V[41]), t(addToText, S[${n}], V[42]), t(addToText, S[${n}], V[43]), t(addToText, S[${n}], V[44]));`,
      ],
      [
        28,
        n => `console.log("addNumberOrText", ${n}, show(addNumberOrText(W[${n}], X[0])), show(addNumberOrText(W[${n}], X[2])), show(addNumberOrText(W[${n}], X[4])), show(addNumberOrText(W[${n}], X[6])), show(addNumberOrText(W[${n}], X[8])), show(addNumberOrText(W[${n}], X[10])), show(addNumberOrText(W[${n}], X[12])), show(addNumberOrText(W[${n}], X[14])), show(addNumberOrText(W[${n}], X[16])), show(addNumberOrText(W[${n}], X[18])), show(addNumberOrText(W[${n}], X[20])), show(addNumberOrText(W[${n}], X[22])), show(addNumberOrText(W[${n}], X[24])), show(addNumberOrText(W[${n}], X[26])));
console.log("sameUnion", ${n}, sameUnion(W[${n}], X[0]), sameUnion(W[${n}], X[1]), sameUnion(W[${n}], X[2]), sameUnion(W[${n}], X[3]), sameUnion(W[${n}], X[4]), sameUnion(W[${n}], X[5]), sameUnion(W[${n}], X[6]), sameUnion(W[${n}], X[7]), sameUnion(W[${n}], X[8]), sameUnion(W[${n}], X[9]), sameUnion(W[${n}], X[10]), sameUnion(W[${n}], X[11]), sameUnion(W[${n}], X[12]), sameUnion(W[${n}], X[13]), sameUnion(W[${n}], X[14]), sameUnion(W[${n}], X[15]), sameUnion(W[${n}], X[16]), sameUnion(W[${n}], X[17]), sameUnion(W[${n}], X[18]), sameUnion(W[${n}], X[19]), sameUnion(W[${n}], X[20]), sameUnion(W[${n}], X[21]), sameUnion(W[${n}], X[22]), sameUnion(W[${n}], X[23]), sameUnion(W[${n}], X[24]), sameUnion(W[${n}], X[25]), sameUnion(W[${n}], X[26]), sameUnion(W[${n}], X[27]));`,
      ],
      ``,
    ),
    "operators-outside-loops.json": `{ "skipInShell": "one function of many thousand blocks: where the back end is validated after each phase, simplifyCFG of B3 and of Air look at every block once for every block, and the build takes over five minutes", "skipInVariant": { "validate-back-end": "one function of many thousand blocks: where the back end is validated after each phase, simplifyCFG of B3 and of Air look at every block once for every block, and the build takes over five minutes" } }
`,
    "operators-outside-loops.ts": text(
      `// Binary operators, \`===\`, truthiness, string conversion and comparisons with string literals in code outside loops.
declare const console: { log(...values: unknown[]): void };
function rope(a: string, b: string): string { return a + b; }
function part(s: string): string { return s.substring(1, s.length - 1); }
function wide(s: string): string { return (s + "Ā").slice(0, -1); }
const withValueOf: any = { valueOf() { return 42; } };
const withToString: any = { toString() { return "told"; } };
const withPrimitive: any = { [Symbol.toPrimitive](hint: string) { return hint === "number" ? 3 : hint === "string" ? "str" : "def"; } };
const throws: any = { valueOf() { throw new RangeError("asked"); }, toString() { throw new RangeError("asked for a string"); } };
const symbol: any = Symbol("s");
const f: any = Object.assign(function named() { }, { toString() { return "fn"; } });
const V: any[] = [0, -0, 1, -1, 0.5, 1e21, 1e-7, NaN, Infinity, -Infinity, 2147483647, 2147483648, -2147483649, 9007199254740993, "", "a", "7", " 12 ", "abc", "0x10", rope("ab", "c"), rope("", "7"), part("xabcx"), wide("abc"), "\\u0100", rope("\\u0100", "b"), rope(rope("a text of thirty", "-two "), rope("charac", "ters!")), true, false, null, undefined, 0n, 1n, -5n, 12345678901234567890n, {}, [], [7], [1, 2], withValueOf, withToString, withPrimitive, throws, symbol, f];
const N: number[] = [0, -0, 1, -1, 0.5, 1e21, 1e-7, NaN, Infinity, -Infinity, 2147483647, 2147483648, -2147483649, 9007199254740993];
const S: string[] = ["", "a", "7", " 12 ", "abc", "0x10", rope("ab", "c"), rope("", "7"), part("xabcx"), wide("abc"), "\\u0100", rope("\\u0100", "b"), rope(rope("a text of thirty", "-two "), rope("charac", "ters!"))];
const U: (string | number | boolean | null | undefined)[] = [0, -0, 1, -1, 0.5, 1e21, 1e-7, NaN, Infinity, -Infinity, 2147483647, 2147483648, -2147483649, 9007199254740993, "", "a", "7", " 12 ", "abc", "0x10", rope("ab", "c"), rope("", "7"), part("xabcx"), wide("abc"), "\\u0100", rope("\\u0100", "b"), rope(rope("a text of thirty", "-two "), rope("charac", "ters!")), true, false, null, undefined];
const W: (string | number | null)[] = [0, -0, 1, -1, 0.5, 1e21, 1e-7, NaN, Infinity, -Infinity, 2147483647, 2147483648, -2147483649, 9007199254740993, "", "a", "7", " 12 ", "abc", "0x10", rope("ab", "c"), rope("", "7"), part("xabcx"), wide("abc"), "\\u0100", rope("\\u0100", "b"), rope(rope("a text of thirty", "-two "), rope("charac", "ters!")), null];
const X: (string | number | undefined)[] = [0, -0, 1, -1, 0.5, 1e21, 1e-7, NaN, Infinity, -Infinity, 2147483647, 2147483648, -2147483649, 9007199254740993, "", "a", "7", " 12 ", "abc", "0x10", rope("ab", "c"), rope("", "7"), part("xabcx"), wide("abc"), "\\u0100", rope("\\u0100", "b"), rope(rope("a text of thirty", "-two "), rope("charac", "ters!")), undefined];
const Y: (string | null | undefined)[] = ["", "a", "7", " 12 ", "abc", "0x10", rope("ab", "c"), rope("", "7"), part("xabcx"), wide("abc"), "\\u0100", rope("\\u0100", "b"), rope(rope("a text of thirty", "-two "), rope("charac", "ters!")), null, undefined];
function show(v: any): string { return typeof v === "bigint" ? String(v) + "n" : typeof v === "string" ? JSON.stringify(v) : typeof v === "symbol" ? "symbol" : Object.is(v, -0) ? "-0" : String(v); }
function t(op: (a: any, b: any) => any, a: any, b: any): string { try { return show(op(a, b)); } catch (e: any) { return e.name + ": " + e.message; } }
function u(op: (a: any) => any, a: any): string { try { return show(op(a)); } catch (e: any) { return e.name + ": " + e.message; } }
function add(a: any, b: any): any { return a + b; }
function sub(a: any, b: any): any { return a - b; }
function mul(a: any, b: any): any { return a * b; }
function div(a: any, b: any): any { return a / b; }
function mod(a: any, b: any): any { return a % b; }
function pow(a: any, b: any): any { return a ** b; }
function and(a: any, b: any): any { return a & b; }
function or(a: any, b: any): any { return a | b; }
function xor(a: any, b: any): any { return a ^ b; }
function shl(a: any, b: any): any { return a << b; }
function shr(a: any, b: any): any { return a >> b; }
function ushr(a: any, b: any): any { return a >>> b; }
function same(a: any, b: any): boolean { return a === b; }
function other(a: any, b: any): boolean { return a !== b; }
function sameUnion(a: string | number | null, b: string | number | undefined): boolean { return a === b; }
function truth(a: any): string { return a ? "yes" : "no"; }
function not(a: any): boolean { return !a; }
function truthUnion(a: string | number | boolean | null | undefined): number { return a ? 1 : 0; }
function text(a: any): string { return \`<\${a}>\`; }
function textOfNumber(a: number): string { return \`\${a}\`; }
function textOfInteger(a: number): string { return \`\${a | 0}:\${(a | 0) + 1}\`; }
function textOfUnion(a: string | number | boolean | null | undefined): string { return "" + a; }
function addToText(a: string, b: any): string { return a + b; }
function addNumberOrText(a: number | string | null, b: number | string | undefined): number | string { return (a as any) + (b as any); }
function one(s: any): string { if (s === "abc") return "is abc"; return "no"; }
function ladder(s: any): string {
  if (s === "a") return "a"; else if (s === "7") return "seven"; else if (s === "abc") return "abc"; else if (s === "abd") return "abd"; else if (s === "Ā") return "A-macron";
  else if (s === "told") return "told"; else if (s === "a text of thirty-two characters!") return "32"; else if (s === "") return "empty";
  return "none";
}
function ladderOfString(s: string): number {
  switch (s) { case "a": return 1; case "7": return 2; case "abc": return 3; case "abd": return 4; case " 12 ": return 5; case "0x10": return 6; case "Ā": return 7; case "Āb": return 8; default: return 0; }
}
function ladderOrNil(s: string | null | undefined): number { if (s === "abc") return 1; if (s === "7") return 2; if (s === "ab") return 3; return 0; }
`,
      [
        45,
        n =>
          `console.log("add", ${n}, t(add, V[${n}], V[0]), t(add, V[${n}], V[1]), t(add, V[${n}], V[2]), t(add, V[${n}], V[4]), t(add, V[${n}], V[7]), t(add, V[${n}], V[10]), t(add, V[${n}], V[16]), t(add, V[${n}], V[18]), t(add, V[${n}], V[20]), t(add, V[${n}], V[23]), t(add, V[${n}], V[27]), t(add, V[${n}], V[29]), t(add, V[${n}], V[30]), t(add, V[${n}], V[32]), t(add, V[${n}], V[33]), t(add, V[${n}], V[35]), t(add, V[${n}], V[37]), t(add, V[${n}], V[39]), t(add, V[${n}], V[40]), t(add, V[${n}], V[41]), t(add, V[${n}], V[42]), t(add, V[${n}], V[43]));`,
      ],
      [
        45,
        n =>
          `console.log("sub", ${n}, t(sub, V[${n}], V[0]), t(sub, V[${n}], V[1]), t(sub, V[${n}], V[2]), t(sub, V[${n}], V[4]), t(sub, V[${n}], V[7]), t(sub, V[${n}], V[10]), t(sub, V[${n}], V[16]), t(sub, V[${n}], V[18]), t(sub, V[${n}], V[20]), t(sub, V[${n}], V[23]), t(sub, V[${n}], V[27]), t(sub, V[${n}], V[29]), t(sub, V[${n}], V[30]), t(sub, V[${n}], V[32]), t(sub, V[${n}], V[33]), t(sub, V[${n}], V[35]), t(sub, V[${n}], V[37]), t(sub, V[${n}], V[39]), t(sub, V[${n}], V[40]), t(sub, V[${n}], V[41]), t(sub, V[${n}], V[42]), t(sub, V[${n}], V[43]));`,
      ],
      [
        45,
        n =>
          `console.log("mul", ${n}, t(mul, V[${n}], V[0]), t(mul, V[${n}], V[1]), t(mul, V[${n}], V[2]), t(mul, V[${n}], V[4]), t(mul, V[${n}], V[7]), t(mul, V[${n}], V[10]), t(mul, V[${n}], V[16]), t(mul, V[${n}], V[18]), t(mul, V[${n}], V[20]), t(mul, V[${n}], V[23]), t(mul, V[${n}], V[27]), t(mul, V[${n}], V[29]), t(mul, V[${n}], V[30]), t(mul, V[${n}], V[32]), t(mul, V[${n}], V[33]), t(mul, V[${n}], V[35]), t(mul, V[${n}], V[37]), t(mul, V[${n}], V[39]), t(mul, V[${n}], V[40]), t(mul, V[${n}], V[41]), t(mul, V[${n}], V[42]), t(mul, V[${n}], V[43]));`,
      ],
      [
        45,
        n =>
          `console.log("div", ${n}, t(div, V[${n}], V[0]), t(div, V[${n}], V[1]), t(div, V[${n}], V[2]), t(div, V[${n}], V[4]), t(div, V[${n}], V[7]), t(div, V[${n}], V[10]), t(div, V[${n}], V[16]), t(div, V[${n}], V[18]), t(div, V[${n}], V[20]), t(div, V[${n}], V[23]), t(div, V[${n}], V[27]), t(div, V[${n}], V[29]), t(div, V[${n}], V[30]), t(div, V[${n}], V[32]), t(div, V[${n}], V[33]), t(div, V[${n}], V[35]), t(div, V[${n}], V[37]), t(div, V[${n}], V[39]), t(div, V[${n}], V[40]), t(div, V[${n}], V[41]), t(div, V[${n}], V[42]), t(div, V[${n}], V[43]));`,
      ],
      [
        45,
        n =>
          `console.log("mod", ${n}, t(mod, V[${n}], V[0]), t(mod, V[${n}], V[1]), t(mod, V[${n}], V[2]), t(mod, V[${n}], V[4]), t(mod, V[${n}], V[7]), t(mod, V[${n}], V[10]), t(mod, V[${n}], V[16]), t(mod, V[${n}], V[18]), t(mod, V[${n}], V[20]), t(mod, V[${n}], V[23]), t(mod, V[${n}], V[27]), t(mod, V[${n}], V[29]), t(mod, V[${n}], V[30]), t(mod, V[${n}], V[32]), t(mod, V[${n}], V[33]), t(mod, V[${n}], V[35]), t(mod, V[${n}], V[37]), t(mod, V[${n}], V[39]), t(mod, V[${n}], V[40]), t(mod, V[${n}], V[41]), t(mod, V[${n}], V[42]), t(mod, V[${n}], V[43]));`,
      ],
      [
        45,
        n =>
          `console.log("pow", ${n}, t(pow, V[${n}], V[0]), t(pow, V[${n}], V[1]), t(pow, V[${n}], V[2]), t(pow, V[${n}], V[4]), t(pow, V[${n}], V[7]), t(pow, V[${n}], V[10]), t(pow, V[${n}], V[16]), t(pow, V[${n}], V[18]), t(pow, V[${n}], V[20]), t(pow, V[${n}], V[23]), t(pow, V[${n}], V[27]), t(pow, V[${n}], V[29]), t(pow, V[${n}], V[30]), t(pow, V[${n}], V[32]), t(pow, V[${n}], V[33]), t(pow, V[${n}], V[35]), t(pow, V[${n}], V[37]), t(pow, V[${n}], V[39]), t(pow, V[${n}], V[40]), t(pow, V[${n}], V[41]), t(pow, V[${n}], V[42]), t(pow, V[${n}], V[43]));`,
      ],
      [
        45,
        n =>
          `console.log("and", ${n}, t(and, V[${n}], V[0]), t(and, V[${n}], V[1]), t(and, V[${n}], V[2]), t(and, V[${n}], V[4]), t(and, V[${n}], V[7]), t(and, V[${n}], V[10]), t(and, V[${n}], V[16]), t(and, V[${n}], V[18]), t(and, V[${n}], V[20]), t(and, V[${n}], V[23]), t(and, V[${n}], V[27]), t(and, V[${n}], V[29]), t(and, V[${n}], V[30]), t(and, V[${n}], V[32]), t(and, V[${n}], V[33]), t(and, V[${n}], V[35]), t(and, V[${n}], V[37]), t(and, V[${n}], V[39]), t(and, V[${n}], V[40]), t(and, V[${n}], V[41]), t(and, V[${n}], V[42]), t(and, V[${n}], V[43]));`,
      ],
      [
        45,
        n =>
          `console.log("or", ${n}, t(or, V[${n}], V[0]), t(or, V[${n}], V[1]), t(or, V[${n}], V[2]), t(or, V[${n}], V[4]), t(or, V[${n}], V[7]), t(or, V[${n}], V[10]), t(or, V[${n}], V[16]), t(or, V[${n}], V[18]), t(or, V[${n}], V[20]), t(or, V[${n}], V[23]), t(or, V[${n}], V[27]), t(or, V[${n}], V[29]), t(or, V[${n}], V[30]), t(or, V[${n}], V[32]), t(or, V[${n}], V[33]), t(or, V[${n}], V[35]), t(or, V[${n}], V[37]), t(or, V[${n}], V[39]), t(or, V[${n}], V[40]), t(or, V[${n}], V[41]), t(or, V[${n}], V[42]), t(or, V[${n}], V[43]));`,
      ],
      [
        45,
        n =>
          `console.log("xor", ${n}, t(xor, V[${n}], V[0]), t(xor, V[${n}], V[1]), t(xor, V[${n}], V[2]), t(xor, V[${n}], V[4]), t(xor, V[${n}], V[7]), t(xor, V[${n}], V[10]), t(xor, V[${n}], V[16]), t(xor, V[${n}], V[18]), t(xor, V[${n}], V[20]), t(xor, V[${n}], V[23]), t(xor, V[${n}], V[27]), t(xor, V[${n}], V[29]), t(xor, V[${n}], V[30]), t(xor, V[${n}], V[32]), t(xor, V[${n}], V[33]), t(xor, V[${n}], V[35]), t(xor, V[${n}], V[37]), t(xor, V[${n}], V[39]), t(xor, V[${n}], V[40]), t(xor, V[${n}], V[41]), t(xor, V[${n}], V[42]), t(xor, V[${n}], V[43]));`,
      ],
      [
        45,
        n =>
          `console.log("shl", ${n}, t(shl, V[${n}], V[0]), t(shl, V[${n}], V[1]), t(shl, V[${n}], V[2]), t(shl, V[${n}], V[4]), t(shl, V[${n}], V[7]), t(shl, V[${n}], V[10]), t(shl, V[${n}], V[16]), t(shl, V[${n}], V[18]), t(shl, V[${n}], V[20]), t(shl, V[${n}], V[23]), t(shl, V[${n}], V[27]), t(shl, V[${n}], V[29]), t(shl, V[${n}], V[30]), t(shl, V[${n}], V[32]), t(shl, V[${n}], V[33]), t(shl, V[${n}], V[35]), t(shl, V[${n}], V[37]), t(shl, V[${n}], V[39]), t(shl, V[${n}], V[40]), t(shl, V[${n}], V[41]), t(shl, V[${n}], V[42]), t(shl, V[${n}], V[43]));`,
      ],
      [
        45,
        n =>
          `console.log("shr", ${n}, t(shr, V[${n}], V[0]), t(shr, V[${n}], V[1]), t(shr, V[${n}], V[2]), t(shr, V[${n}], V[4]), t(shr, V[${n}], V[7]), t(shr, V[${n}], V[10]), t(shr, V[${n}], V[16]), t(shr, V[${n}], V[18]), t(shr, V[${n}], V[20]), t(shr, V[${n}], V[23]), t(shr, V[${n}], V[27]), t(shr, V[${n}], V[29]), t(shr, V[${n}], V[30]), t(shr, V[${n}], V[32]), t(shr, V[${n}], V[33]), t(shr, V[${n}], V[35]), t(shr, V[${n}], V[37]), t(shr, V[${n}], V[39]), t(shr, V[${n}], V[40]), t(shr, V[${n}], V[41]), t(shr, V[${n}], V[42]), t(shr, V[${n}], V[43]));`,
      ],
      [
        45,
        n =>
          `console.log("ushr", ${n}, t(ushr, V[${n}], V[0]), t(ushr, V[${n}], V[1]), t(ushr, V[${n}], V[2]), t(ushr, V[${n}], V[4]), t(ushr, V[${n}], V[7]), t(ushr, V[${n}], V[10]), t(ushr, V[${n}], V[16]), t(ushr, V[${n}], V[18]), t(ushr, V[${n}], V[20]), t(ushr, V[${n}], V[23]), t(ushr, V[${n}], V[27]), t(ushr, V[${n}], V[29]), t(ushr, V[${n}], V[30]), t(ushr, V[${n}], V[32]), t(ushr, V[${n}], V[33]), t(ushr, V[${n}], V[35]), t(ushr, V[${n}], V[37]), t(ushr, V[${n}], V[39]), t(ushr, V[${n}], V[40]), t(ushr, V[${n}], V[41]), t(ushr, V[${n}], V[42]), t(ushr, V[${n}], V[43]));`,
      ],
      [
        45,
        n =>
          `console.log("same", ${n}, t(same, V[${n}], V[0]), t(same, V[${n}], V[1]), t(same, V[${n}], V[2]), t(same, V[${n}], V[4]), t(same, V[${n}], V[7]), t(same, V[${n}], V[10]), t(same, V[${n}], V[16]), t(same, V[${n}], V[18]), t(same, V[${n}], V[20]), t(same, V[${n}], V[23]), t(same, V[${n}], V[27]), t(same, V[${n}], V[29]), t(same, V[${n}], V[30]), t(same, V[${n}], V[32]), t(same, V[${n}], V[33]), t(same, V[${n}], V[35]), t(same, V[${n}], V[37]), t(same, V[${n}], V[39]), t(same, V[${n}], V[40]), t(same, V[${n}], V[41]), t(same, V[${n}], V[42]), t(same, V[${n}], V[43]));`,
      ],
      [
        45,
        n =>
          `console.log("other", ${n}, t(other, V[${n}], V[0]), t(other, V[${n}], V[1]), t(other, V[${n}], V[2]), t(other, V[${n}], V[4]), t(other, V[${n}], V[7]), t(other, V[${n}], V[10]), t(other, V[${n}], V[16]), t(other, V[${n}], V[18]), t(other, V[${n}], V[20]), t(other, V[${n}], V[23]), t(other, V[${n}], V[27]), t(other, V[${n}], V[29]), t(other, V[${n}], V[30]), t(other, V[${n}], V[32]), t(other, V[${n}], V[33]), t(other, V[${n}], V[35]), t(other, V[${n}], V[37]), t(other, V[${n}], V[39]), t(other, V[${n}], V[40]), t(other, V[${n}], V[41]), t(other, V[${n}], V[42]), t(other, V[${n}], V[43]));`,
      ],
      `console.log("truth", u(truth, V[0]), u(truth, V[1]), u(truth, V[2]), u(truth, V[3]), u(truth, V[4]), u(truth, V[5]), u(truth, V[6]), u(truth, V[7]), u(truth, V[8]), u(truth, V[9]), u(truth, V[10]), u(truth, V[11]), u(truth, V[12]), u(truth, V[13]), u(truth, V[14]), u(truth, V[15]), u(truth, V[16]), u(truth, V[17]), u(truth, V[18]), u(truth, V[19]), u(truth, V[20]), u(truth, V[21]), u(truth, V[22]), u(truth, V[23]), u(truth, V[24]), u(truth, V[25]), u(truth, V[26]), u(truth, V[27]), u(truth, V[28]), u(truth, V[29]), u(truth, V[30]), u(truth, V[31]), u(truth, V[32]), u(truth, V[33]), u(truth, V[34]), u(truth, V[35]), u(truth, V[36]), u(truth, V[37]), u(truth, V[38]), u(truth, V[39]), u(truth, V[40]), u(truth, V[41]), u(truth, V[42]), u(truth, V[43]), u(truth, V[44]));
console.log("not", u(not, V[0]), u(not, V[1]), u(not, V[2]), u(not, V[3]), u(not, V[4]), u(not, V[5]), u(not, V[6]), u(not, V[7]), u(not, V[8]), u(not, V[9]), u(not, V[10]), u(not, V[11]), u(not, V[12]), u(not, V[13]), u(not, V[14]), u(not, V[15]), u(not, V[16]), u(not, V[17]), u(not, V[18]), u(not, V[19]), u(not, V[20]), u(not, V[21]), u(not, V[22]), u(not, V[23]), u(not, V[24]), u(not, V[25]), u(not, V[26]), u(not, V[27]), u(not, V[28]), u(not, V[29]), u(not, V[30]), u(not, V[31]), u(not, V[32]), u(not, V[33]), u(not, V[34]), u(not, V[35]), u(not, V[36]), u(not, V[37]), u(not, V[38]), u(not, V[39]), u(not, V[40]), u(not, V[41]), u(not, V[42]), u(not, V[43]), u(not, V[44]));
console.log("text", u(text, V[0]), u(text, V[1]), u(text, V[2]), u(text, V[3]), u(text, V[4]), u(text, V[5]), u(text, V[6]), u(text, V[7]), u(text, V[8]), u(text, V[9]), u(text, V[10]), u(text, V[11]), u(text, V[12]), u(text, V[13]), u(text, V[14]), u(text, V[15]), u(text, V[16]), u(text, V[17]), u(text, V[18]), u(text, V[19]), u(text, V[20]), u(text, V[21]), u(text, V[22]), u(text, V[23]), u(text, V[24]), u(text, V[25]), u(text, V[26]), u(text, V[27]), u(text, V[28]), u(text, V[29]), u(text, V[30]), u(text, V[31]), u(text, V[32]), u(text, V[33]), u(text, V[34]), u(text, V[35]), u(text, V[36]), u(text, V[37]), u(text, V[38]), u(text, V[39]), u(text, V[40]), u(text, V[41]), u(text, V[42]), u(text, V[43]), u(text, V[44]));
console.log("one", u(one, V[0]), u(one, V[1]), u(one, V[2]), u(one, V[3]), u(one, V[4]), u(one, V[5]), u(one, V[6]), u(one, V[7]), u(one, V[8]), u(one, V[9]), u(one, V[10]), u(one, V[11]), u(one, V[12]), u(one, V[13]), u(one, V[14]), u(one, V[15]), u(one, V[16]), u(one, V[17]), u(one, V[18]), u(one, V[19]), u(one, V[20]), u(one, V[21]), u(one, V[22]), u(one, V[23]), u(one, V[24]), u(one, V[25]), u(one, V[26]), u(one, V[27]), u(one, V[28]), u(one, V[29]), u(one, V[30]), u(one, V[31]), u(one, V[32]), u(one, V[33]), u(one, V[34]), u(one, V[35]), u(one, V[36]), u(one, V[37]), u(one, V[38]), u(one, V[39]), u(one, V[40]), u(one, V[41]), u(one, V[42]), u(one, V[43]), u(one, V[44]));
console.log("ladder", u(ladder, V[0]), u(ladder, V[1]), u(ladder, V[2]), u(ladder, V[3]), u(ladder, V[4]), u(ladder, V[5]), u(ladder, V[6]), u(ladder, V[7]), u(ladder, V[8]), u(ladder, V[9]), u(ladder, V[10]), u(ladder, V[11]), u(ladder, V[12]), u(ladder, V[13]), u(ladder, V[14]), u(ladder, V[15]), u(ladder, V[16]), u(ladder, V[17]), u(ladder, V[18]), u(ladder, V[19]), u(ladder, V[20]), u(ladder, V[21]), u(ladder, V[22]), u(ladder, V[23]), u(ladder, V[24]), u(ladder, V[25]), u(ladder, V[26]), u(ladder, V[27]), u(ladder, V[28]), u(ladder, V[29]), u(ladder, V[30]), u(ladder, V[31]), u(ladder, V[32]), u(ladder, V[33]), u(ladder, V[34]), u(ladder, V[35]), u(ladder, V[36]), u(ladder, V[37]), u(ladder, V[38]), u(ladder, V[39]), u(ladder, V[40]), u(ladder, V[41]), u(ladder, V[42]), u(ladder, V[43]), u(ladder, V[44]));
console.log("ladderOfString", ladderOfString(S[0]!), ladderOfString(S[1]!), ladderOfString(S[2]!), ladderOfString(S[3]!), ladderOfString(S[4]!), ladderOfString(S[5]!), ladderOfString(S[6]!), ladderOfString(S[7]!), ladderOfString(S[8]!), ladderOfString(S[9]!), ladderOfString(S[10]!), ladderOfString(S[11]!), ladderOfString(S[12]!));
console.log("ladderOrNil", ladderOrNil(Y[0]), ladderOrNil(Y[1]), ladderOrNil(Y[2]), ladderOrNil(Y[3]), ladderOrNil(Y[4]), ladderOrNil(Y[5]), ladderOrNil(Y[6]), ladderOrNil(Y[7]), ladderOrNil(Y[8]), ladderOrNil(Y[9]), ladderOrNil(Y[10]), ladderOrNil(Y[11]), ladderOrNil(Y[12]), ladderOrNil(Y[13]), ladderOrNil(Y[14]));
console.log("textOfNumber", textOfNumber(N[0]!), textOfNumber(N[1]!), textOfNumber(N[2]!), textOfNumber(N[3]!), textOfNumber(N[4]!), textOfNumber(N[5]!), textOfNumber(N[6]!), textOfNumber(N[7]!), textOfNumber(N[8]!), textOfNumber(N[9]!), textOfNumber(N[10]!), textOfNumber(N[11]!), textOfNumber(N[12]!), textOfNumber(N[13]!));
console.log("textOfInteger", textOfInteger(N[0]!), textOfInteger(N[1]!), textOfInteger(N[2]!), textOfInteger(N[3]!), textOfInteger(N[4]!), textOfInteger(N[5]!), textOfInteger(N[6]!), textOfInteger(N[7]!), textOfInteger(N[8]!), textOfInteger(N[9]!), textOfInteger(N[10]!), textOfInteger(N[11]!), textOfInteger(N[12]!), textOfInteger(N[13]!));
console.log("textOfUnion", textOfUnion(U[0]), textOfUnion(U[1]), textOfUnion(U[2]), textOfUnion(U[3]), textOfUnion(U[4]), textOfUnion(U[5]), textOfUnion(U[6]), textOfUnion(U[7]), textOfUnion(U[8]), textOfUnion(U[9]), textOfUnion(U[10]), textOfUnion(U[11]), textOfUnion(U[12]), textOfUnion(U[13]), textOfUnion(U[14]), textOfUnion(U[15]), textOfUnion(U[16]), textOfUnion(U[17]), textOfUnion(U[18]), textOfUnion(U[19]), textOfUnion(U[20]), textOfUnion(U[21]), textOfUnion(U[22]), textOfUnion(U[23]), textOfUnion(U[24]), textOfUnion(U[25]), textOfUnion(U[26]), textOfUnion(U[27]), textOfUnion(U[28]), textOfUnion(U[29]), textOfUnion(U[30]));
console.log("truthUnion", truthUnion(U[0]), truthUnion(U[1]), truthUnion(U[2]), truthUnion(U[3]), truthUnion(U[4]), truthUnion(U[5]), truthUnion(U[6]), truthUnion(U[7]), truthUnion(U[8]), truthUnion(U[9]), truthUnion(U[10]), truthUnion(U[11]), truthUnion(U[12]), truthUnion(U[13]), truthUnion(U[14]), truthUnion(U[15]), truthUnion(U[16]), truthUnion(U[17]), truthUnion(U[18]), truthUnion(U[19]), truthUnion(U[20]), truthUnion(U[21]), truthUnion(U[22]), truthUnion(U[23]), truthUnion(U[24]), truthUnion(U[25]), truthUnion(U[26]), truthUnion(U[27]), truthUnion(U[28]), truthUnion(U[29]), truthUnion(U[30]));`,
      [
        13,
        n =>
          `console.log("addToText", ${n}, t(addToText, S[${n}], V[0]), t(addToText, S[${n}], V[1]), t(addToText, S[${n}], V[2]), t(addToText, S[${n}], V[3]), t(addToText, S[${n}], V[4]), t(addToText, S[${n}], V[5]), t(addToText, S[${n}], V[6]), t(addToText, S[${n}], V[7]), t(addToText, S[${n}], V[8]), t(addToText, S[${n}], V[9]), t(addToText, S[${n}], V[10]), t(addToText, S[${n}], V[11]), t(addToText, S[${n}], V[12]), t(addToText, S[${n}], V[13]), t(addToText, S[${n}], V[14]), t(addToText, S[${n}], V[15]), t(addToText, S[${n}], V[16]), t(addToText, S[${n}], V[17]), t(addToText, S[${n}], V[18]), t(addToText, S[${n}], V[19]), t(addToText, S[${n}], V[20]), t(addToText, S[${n}], V[21]), t(addToText, S[${n}], V[22]), t(addToText, S[${n}], V[23]), t(addToText, S[${n}], V[24]), t(addToText, S[${n}], V[25]), t(addToText, S[${n}], V[26]), t(addToText, S[${n}], V[27]), t(addToText, S[${n}], V[28]), t(addToText, S[${n}], V[29]), t(addToText, S[${n}], V[30]), t(addToText, S[${n}], V[31]), t(addToText, S[${n}], V[32]), t(addToText, S[${n}], V[33]), t(addToText, S[${n}], V[34]), t(addToText, S[${n}], V[35]), t(addToText, S[${n}], V[36]), t(addToText, S[${n}], V[37]), t(addToText, S[${n}], V[38]), t(addToText, S[${n}], V[39]), t(addToText, S[${n}], V[40]), t(addToText, S[${n}], V[41]), t(addToText, S[${n}], V[42]), t(addToText, S[${n}], V[43]), t(addToText, S[${n}], V[44]));`,
      ],
      [
        28,
        n => `console.log("addNumberOrText", ${n}, show(addNumberOrText(W[${n}], X[0])), show(addNumberOrText(W[${n}], X[2])), show(addNumberOrText(W[${n}], X[4])), show(addNumberOrText(W[${n}], X[6])), show(addNumberOrText(W[${n}], X[8])), show(addNumberOrText(W[${n}], X[10])), show(addNumberOrText(W[${n}], X[12])), show(addNumberOrText(W[${n}], X[14])), show(addNumberOrText(W[${n}], X[16])), show(addNumberOrText(W[${n}], X[18])), show(addNumberOrText(W[${n}], X[20])), show(addNumberOrText(W[${n}], X[22])), show(addNumberOrText(W[${n}], X[24])), show(addNumberOrText(W[${n}], X[26])));
console.log("sameUnion", ${n}, sameUnion(W[${n}], X[0]), sameUnion(W[${n}], X[1]), sameUnion(W[${n}], X[2]), sameUnion(W[${n}], X[3]), sameUnion(W[${n}], X[4]), sameUnion(W[${n}], X[5]), sameUnion(W[${n}], X[6]), sameUnion(W[${n}], X[7]), sameUnion(W[${n}], X[8]), sameUnion(W[${n}], X[9]), sameUnion(W[${n}], X[10]), sameUnion(W[${n}], X[11]), sameUnion(W[${n}], X[12]), sameUnion(W[${n}], X[13]), sameUnion(W[${n}], X[14]), sameUnion(W[${n}], X[15]), sameUnion(W[${n}], X[16]), sameUnion(W[${n}], X[17]), sameUnion(W[${n}], X[18]), sameUnion(W[${n}], X[19]), sameUnion(W[${n}], X[20]), sameUnion(W[${n}], X[21]), sameUnion(W[${n}], X[22]), sameUnion(W[${n}], X[23]), sameUnion(W[${n}], X[24]), sameUnion(W[${n}], X[25]), sameUnion(W[${n}], X[26]), sameUnion(W[${n}], X[27]));`,
      ],
      ``,
    ),
  });
