// Programs made of expressions that a compiler may work out while it builds: literals, operators, `Math`, `Number`, methods of strings and
// numbers on literals, and `const`s that hold such values. Whatever is folded must come out as the engine computes it when the program runs.
//
// A program is a seed. The same seed always writes the same program.

/** Numbers from 0 up to 1, the same for the same seed. */
export function randomFrom(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, choice: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)], upTo: (least: number, most: number) => least + Math.floor(next() * (most - least + 1)) };
}

// prettier-ignore
const numbers = ["0", "-0", "1", "-1", "2", "3", "7", "10", "0.1", "0.2", "0.5", "-0.5", "1.5", "2.5", "-2.5", "1e21", "1e-7", "1e300", "-1e300", "5e-324", "1.7976931348623157e308", "2147483647", "2147483648", "-2147483648", "-2147483649", "4294967295", "4294967296", "9007199254740991", "9007199254740992", "9007199254740993", "NaN", "Infinity", "-Infinity", "0x7fffffff", "255", "256", "31", "32", "33", "63", "64", "123.456", "0.000001", "1e6", "1/3", "100", "1e22", "0.30000000000000004", "3.141592653589793", "2.718281828459045", "1e-10", "12345.6789", "-7", "1073741824", "65535", "65536"];
// prettier-ignore
const strings = ['""', '"a"', '"abc"', '"0"', '"1"', '"-1"', '" 12 "', '"1e3"', '"0x1F"', '"0b11"', '"0o7"', '"1_0"', '"Infinity"', '"-Infinity"', '"NaN"', '"-0"', '"."', '".5"', '"5."', '"+5"', '"1,2"', '"é"', '"😀"', '"a😀b"', '"\\n"', '"\\t1\\n"', '"null"', '"true"', '"ABC"', '"ß"', '"İ"', '"ǆ"', '"ﬁ"', '"a b c"', '"aaa"', '"10"', '"9"', '"\\u00a0 7"', '"\\ufeff8"', '"1n"', '"12px"', '"\\ud800"'];
const others = ["true", "false", "null", "undefined"];
// prettier-ignore
const bigIntegers = ["0n", "1n", "-1n", "2n", "7n", "-7n", "64n", "9007199254740993n", "-9223372036854775808n", "18446744073709551615n", "255n", "3n"];
const unary = ["-", "+", "~", "!", "typeof ", "void "];
// prettier-ignore
const ofOne = ["abs", "acos", "acosh", "asin", "asinh", "atan", "atanh", "cbrt", "ceil", "clz32", "cos", "cosh", "exp", "expm1", "floor", "fround", "log", "log10", "log1p", "log2", "round", "sign", "sin", "sinh", "sqrt", "tan", "tanh", "trunc", "f16round"];
const ofTwo = ["atan2", "pow", "imul", "max", "min", "hypot"];
// prettier-ignore
const conversions = ["Number", "String", "Boolean", "parseInt", "parseFloat", "isNaN", "isFinite", "Number.isInteger", "Number.isSafeInteger", "Number.parseFloat"];
// prettier-ignore
const ofStrings = [".length", ".charCodeAt(0)", ".charCodeAt(1)", ".codePointAt(0)", ".charAt(1)", "[0]", "[1]", "[5]", ".at(-1)", ".toUpperCase()", ".toLowerCase()", ".trim()", ".trimStart()", ".slice(1)", ".slice(-1)", ".slice(1, -1)", ".substring(2, 0)", ".substr(-2, 1)", '.indexOf("a")', '.lastIndexOf("a")', '.includes("")', '.startsWith("a")', '.endsWith("c")', ".repeat(2)", '.padStart(5, "xy")', ".padEnd(4)", ".concat(1, null)", '.split("").length', '.split(" ").length', '.replace("a", "$&$&")', '.replaceAll("a", "b")', '.localeCompare("b")', '.normalize("NFD").length', ".isWellFormed()", ".toWellFormed().length", '.search("b")', '.match("a")?.index'];
// prettier-ignore
const ofNumbers = [".toString()", ".toString(2)", ".toString(16)", ".toString(36)", ".toFixed(0)", ".toFixed(2)", ".toFixed(10)", ".toPrecision(1)", ".toPrecision(3)", ".toPrecision(21)", ".toExponential()", ".toExponential(2)", ".valueOf()", '.toLocaleString("en-US")'];

const helpers = `const units = (s) => { let o = ""; for (let i = 0; i < s.length; i++) o += (i ? "." : "") + s.charCodeAt(i).toString(16); return o; };
const say = (i, f) => { let v; try { v = f(); } catch (e) { v = "THROWS " + e.constructor.name; console.log(i, v); return; } console.log(i, typeof v === "number" ? (Object.is(v, -0) ? "-0" : v === Math.round(v) || v !== v || !isFinite(v) ? String(v) : v.toPrecision(17)) : typeof v === "string" ? "s:" + units(v) : typeof v === "bigint" ? v + "n" : String(v)); };`;

export function program(seed: number, isTypeScript: boolean, count = 2500): { file: string; text: string } {
  const { next, choice } = randomFrom(seed);
  // In TypeScript `a < ((b) > (c))` is read as type arguments.
  const allowed = (operator: string) => !isTypeScript || !["<", "<<", "<="].includes(operator);
  // prettier-ignore
  const binary = ["+", "-", "*", "/", "%", "**", "&", "|", "^", "<<", ">>", ">>>", "<", ">", "<=", ">=", "==", "!=", "===", "!==", "&&", "||", "??"].filter(allowed);
  const binaryOnBigIntegers = ["+", "-", "*", "/", "%", "**", "&", "|", "^", "<<", ">>", "<", ">", "<=", ">=", "==", "==="].filter(allowed);
  const inParentheses = (text: string) => "(" + text + ")";
  const value = () => {
    const k = next();
    return k < 0.55 ? choice(numbers) : k < 0.8 ? choice(strings) : choice(others);
  };
  const expression = (depth: number): string => {
    const k = next();
    if (depth <= 0 || k < 0.12) return inParentheses(value());
    if (k < 0.5) {
      const operator = choice(binary);
      let [a, b] = [expression(depth - 1), expression(depth - 1)];
      if (operator === "**") a = inParentheses(a);
      if (operator === "??") return inParentheses(inParentheses(a) + " ?? " + inParentheses(b));
      if (operator === "&&" || operator === "||") return inParentheses(inParentheses(a) + " " + operator + " " + inParentheses(b));
      return inParentheses(a + " " + operator + " " + b);
    }
    if (k < 0.6) return inParentheses(choice(unary) + expression(depth - 1));
    if (k < 0.72) return "Math." + choice(ofOne) + inParentheses(expression(depth - 1));
    if (k < 0.8) return "Math." + choice(ofTwo) + inParentheses(expression(depth - 1) + ", " + expression(depth - 1));
    if (k < 0.86) return choice(conversions) + inParentheses(expression(depth - 1));
    if (k < 0.9) return inParentheses(expression(depth - 1) + " ? " + expression(depth - 1) + " : " + expression(depth - 1));
    if (k < 0.93) return "`" + choice(["", "a", " "]) + "${" + expression(depth - 1) + "}" + choice(["", "b"]) + "${" + expression(depth - 1) + "}`";
    if (k < 0.97) return inParentheses(choice(strings) + choice(ofStrings));
    return inParentheses(inParentheses(choice(numbers.filter(number => !number.startsWith("-") && !number.includes("/")))) + choice(ofNumbers));
  };
  const bigInteger = (depth: number): string => {
    if (depth <= 0 || next() < 0.25) return inParentheses(choice(bigIntegers));
    const k = next();
    if (k < 0.8) {
      const operator = choice(binaryOnBigIntegers);
      let [a, b] = [bigInteger(depth - 1), bigInteger(depth - 1)];
      if (["**", "<<", ">>"].includes(operator)) b = inParentheses(choice(["0n", "1n", "2n", "3n", "64n", "7n"]));
      return ["<", ">", "<=", ">=", "==", "==="].includes(operator) ? "BigInt(" + a + " " + operator + " " + b + ")" : inParentheses(inParentheses(a) + " " + operator + " " + b);
    }
    if (k < 0.9) return inParentheses(choice(["-", "~"]) + bigInteger(depth - 1));
    return choice(["BigInt.asIntN", "BigInt.asUintN"]) + "(" + choice(["0", "1", "8", "63", "64", "65"]) + ", " + bigInteger(depth - 1) + ")";
  };
  const lines = ["// @ts-nocheck", helpers];
  for (let i = 0; i < count; i++) {
    const written = next() < 0.12 ? bigInteger(3) : expression(choice([1, 2, 2, 3]));
    lines.push(next() < 0.3 ? `say(${i}, () => { const c${i} = ${written}; const d${i} = c${i}; return d${i}; });` : `say(${i}, () => ${written});`);
  }
  return { file: isTypeScript ? "main.ts" : "main.mjs", text: lines.join("\n") + "\n" };
}
