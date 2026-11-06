// Small functions with one number in a variable that holds other kinds of numbers, or other things, at other times. The number is handed, right there, to everything in the language and the library that takes a number: the answer hangs on its value alone, never on how the variable is kept.
//
//   kept      a parameter, a constant, a sum with a constant, one of two, a quotient, a rounded number, an element of a list or a typed array, a field, a result, a length, a parsed text; alone or beside undefined, null, a string, a boolean, a big integer, an object
//   later     the same variable goes on in a loop: whole steps, halves, doublings past int32, a change of sign, an element, a field, a closure that changes it
//   known     nothing, or a test in front of the use: it is 9, it is whole, it is an int32, it lies in a range
//   values    small whole numbers, fractions, -0, NaN, the infinities, the ends of int32, uint32 and the safe integers; written at the call, at two calls, or read from a parsed text
//   uses      as an element, an index, a length, a count, a key, a field, an argument, a result, an operand, a case, a bound of a loop, a character code, a radix, a number of digits, text
//
// Nothing leaves the function but what it prints.
import type { Random } from "./random";

const prelude = `declare function structuredClone<T>(value: T): T;
function show(x: unknown): string {
  if (typeof x === "number") return Object.is(x, -0) ? "-0" : String(x);
  if (typeof x === "string") return "'" + x + "'";
  if (typeof x === "bigint") return x + "n";
  if (x === undefined) return "u";
  if (Array.isArray(x)) {
    let all = "[";
    for (let i = 0; i < x.length && i < 12; i++) all += (i ? "," : "") + (i in x ? show(x[i]) : "hole");
    return all + "]" + x.length;
  }
  return String(x);
}
function num(x: number): string {
  return Object.is(x, -0) ? "-0" : String(x);
}
function twice(x: number): number {
  return x * 2;
}
function half(x: number): number {
  return x / 2;
}
function same<T>(x: T): T {
  return x;
}
function sum(...all: number[]): number {
  let s = 0;
  for (const e of all) s += e;
  return s;
}
function orSeven(x?: number): number {
  return x === undefined ? 7 : x;
}
function elementOf(l: number[], i: number): number | undefined {
  return l[i];
}
function deep(x: number, depth: number): number {
  return depth === 0 ? x : deep(x, depth - 1);
}
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
class Cell {
  #v = 0;
  static last = 0;
  get value(): number {
    return this.#v;
  }
  set value(v: number) {
    this.#v = v;
  }
}
let shared: number = 0;
const zero: number = 0;
const three: number = 3;
const nine: number = 9;
const names = new Map<number, string>([[0, "zero"], [3, "three"], [9, "nine"], [4.5, "half"], [-1, "minus"], [2147483647, "most"], [4294967295, "word"], [NaN, "none"]]);
const known = new Set<number>([0, 3, 9, 4.5, -1, 2147483648, NaN]);
const words: Record<number, string> = { 0: "zero", 3: "three", 9: "nine", 64: "more" };
const given: number[] = JSON.parse("[3, 9, 0.5, 60, 0, -1, 4.5, 2147483647]");`;

// What the variable starts with. `p` and `q` are the parameters.
const starts = ["p", "p", "p", "p + 6", "p + 6", "3", "9", "0", "p > q ? 9 : 0.5", "p > q ? 0.5 : 9", "p > q ? 3 : 9", "p < q ? p : 0.5", "Math.floor(p / 2)", "Math.round(q)", "Math.trunc(p / 3)", "Math.ceil(q / 4)", "Math.abs(p)", "Math.sign(p)", "Math.min(p, q)", "Math.max(p, 4.5)", "p / 2", "p * 2", "p * q", "p - q", "p % 4", "-p % 4", "p ** 2", "p << 2", "p >> 1", "p >>> 0", "(p - 10) >>> 0", "~p", "p | 0", "p & 15", "p * 0", "-p * 0", "0 / p", "p / p", "p - p", 'Number("9")', '+"3"', 'parseInt("9px", 10)', 'parseFloat("4.50")', '"abcdefghi".length', "text.length", "text.charCodeAt(1) - 95", 'text.indexOf("d")', "given[0]", "given[1]", "given[2]", "given[p & 7]", "floats[0]", "floats[1]", "ints[0]", "bytes[0]", "wide[1]", "home.v", "cell.value", "half(p * 2)", "twice(p)", "same(p)", "orSeven()", "orSeven(p)", "sum(p, q)", "deep(p, 2)", "Number(BigInt(9))", "new Date(p).getTime()", "[p, q][0]", "[0.5, p][1]", "[p, q].length", "9007199254740991", "2147483647", "2147483648", "-2147483648", "4294967295", "4294967296", "-0", "NaN", "Infinity", "1e21", "0.1 + 0.2", "9.0"];
// How it goes on. `x` is the counter of the loop around.
const advances = ["a += 1;", "a += 6;", "a += q;", "a += q;", "a += 0.5;", "a += 0.5;", "a -= 1;", "a *= 2;", "a /= 2;", "a /= 2;", "a *= 65536;", "a = -a;", "a++;", "a--;", "a = a * a;", "a %= 5;", "a = a + 1000000000;", "a = Math.floor(a / 2);", "a = a | 0;", "a = a >>> 0;", "a = floats[turns & 3];", "a = ints[turns & 3];", "a = given[turns & 7];", "a = home.v;\n  home.v += q;", "a = x;", "a = x / 2;", "a = x * 0.5 + 3;", "a = twice(a);", "a = half(a);", "a = a + x;", "a = 9;", "a = 4.5;", "a = a === 9 ? 3 : 9;"];
// What else the variable may hold.
const others: [string, string][] = [["undefined", "undefined"], ["null", "null"], ["string", '"text"'], ["boolean", "false"], ["bigint", "9n"], ["number[]", "[1]"], ["Point", "new Point(1, 2)"]];
// A test in front of the uses.
const tests = ["N === nine", "N === nine", "N === three", "N === zero", "Number.isInteger(N)", "(N | 0) === N", "N >>> 0 === N", "N >= 0 && N < 10", "N === Math.floor(N)", "N !== 0", "N > 0", "N === N", "N % 1 === 0", "Number.isSafeInteger(N)", "N < 2147483648 && N >= -2147483648", "N !== nine", "N === nine || N === three", "N >= three && N <= nine"];
// The same value by another road.
const roads = ["(N + 1 - 1)", "Number(String(N))", '+("" + N)', "N * 1", "same(N)", "[N][0]", "-(-N)", "N / 1", "Math.max(N, N)", "deep(N, 1)"];

const kinds = ["Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array", "Float32Array", "Float64Array"];
const freshLists = ["[]", "[]", "[1, 2]", "[1, 2, 3]", "[0.5]", "[0.5, 1.5]", "[N]", "[N]", "[N, N]", "[1, N]", "[N, 0.5]", "[1, 2, 3, 4, 5, 6, 7, 8]", "[R]", "[N, R]"];
const fullLists = ["[0, 3, 9, 4.5, -1]", "[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]", "[NaN, -0, 9]", "[9, 9, 9]", "[0.5, 3, 9]", "[3, 9]", "[N, 3, 9]", "[0, R, 3]"];

// `l` is a list made right there. After these it has few elements.
const listChanges = ["l.push(N);", "l.push(N);", "l.push(N);", "l.push(N, N);", "l.push(N);\n    l.push(R);", "l.push(1);\n    l.push(N);", "l[0] = N;", "l[1] = N;", "l[l.length] = N;", "l[l.length - 1] = N;", "l.unshift(N);", "l.fill(N);", "l.fill(N, 1);", "l.splice(0, 0, N);", "l.splice(1, 1, N, N);", "l[0] += N;", "l[0] *= N;", "l[0] = l[0] + N;", "l.length = N & 3;", "l.fill(7, N);", "l.fill(7, 0, N);", "l.splice(N, 1);", "l.splice(0, N);", "l.copyWithin(N, 1);", "l.copyWithin(0, N);", "l[N & 3] = 5;", "l[N & 3] = N;", "for (let i = 0; i < 5; i++) l.push(N);", "for (let i = 0; i < 3; i++) l.push(N + i);", "for (let i = 0; i < l.length; i++) l[i] = N;", "for (let i = 0; i < l.length; i++) l[i] += N;", "l.reverse();\n    l.push(N);", "l.pop();\n    l.push(N);", "l.shift();\n    l.push(N);", "l.push(N);\n    l.sort();", "l.push(N);\n    l.sort((x, y) => x - y);"];
const listReads = ['out += num(l[0]) + "," + num(l[1]) + " ";', 'out += l.length + ":" + num(l[0]) + "," + num(l[l.length - 1]) + " ";', 'out += num(l[0] + l[l.length - 1]) + " ";', 'for (let i = 0; i < l.length; i++) out += num(l[i]) + ",";\n    out += " ";', 'for (const e of l) out += num(e) + ",";\n    out += " ";', '{\n      let s = 0;\n      for (let i = 0; i < l.length; i++) s += l[i];\n      out += num(s) + " ";\n    }', '{\n      const [first, second] = l;\n      out += show(first) + "," + show(second) + " ";\n    }', 'out += show(l.at(0)) + "," + show(l.at(-1)) + " ";', 'out += l.join() + " ";', 'out += show(l) + " ";', 'out += num(l[0] | 0) + "," + num(l[l.length - 1] >>> 0) + " ";', 'out += l.indexOf(N) + "," + l.includes(N) + "," + l.lastIndexOf(R) + " ";', 'out += num(l[l.length - 1] * 2) + "," + num(l[0] / 2) + " ";', 'out += (l[l.length - 1] === N) + "," + Object.is(l[l.length - 1], R) + " ";'];
// After these the list may be as long as a list can be: nothing walks it.
const farChanges = ["l[N] = 5;", "l[N] = N;", "l[N + 1] = 5;", "!l.length = N;", "l[N >>> 0] = 5;", "l[N * 2] = 5;", "delete l[N];", "l[-N] = 5;"];
const farReads = ['out += l.length + ":" + show(l[0]) + "," + show(l[N]) + "," + Object.keys(l).join() + " ";', 'out += l.length + ":" + (N in l) + "," + l.hasOwnProperty(N) + "," + show(l[R]) + " ";'];
// A list out of the number, read right there as `m`.
const newLists = ["G.concat(N)", "G.concat([N])", "[...G, N]", "[N, ...G]", "!G.with(0, N)", "!G.with(N, 5)", "G.toSpliced(1, 0, N)", "G.toSpliced(N, 1)", "G.slice(N)", "G.slice(0, N)", "G.slice(-N)", "G.map(e => e + N)", "G.map(e => e * N)", "G.map(() => N)", "G.filter(e => e < N)", "G.filter(e => e === N)", "Array.of(N, N)", "Array.of(N)", "Array.from({ length: N & 3 }, (_, i) => N + i)", "Array.from([N, N])", "new Array<number>(3).fill(N)", "[N, N].concat(G)", "G.flatMap(e => [e, N])", "[N, 3, R].toSorted((x, y) => x - y)", "[N, 3].toReversed()", "Array.from(new Set([N, R]))", "[...new Set([N, R, 9, 0])]", "[...new Map([[N, 1], [R, 2]]).keys()]", "[N, N, N].fill(R, 1)", "[[N, 1], [R, 2]].map(pair => pair[0])", "Object.values({ x: N, y: R })", "Array.from(new Float64Array([N, R]))", "Array.from(new Int32Array([N, R]))", "[N].concat(R, [N])"];
// One value out of a list and the number.
const fromLists = ["G.indexOf(N)", "G.lastIndexOf(N)", "G.includes(N)", "G.indexOf(3, N)", "G.includes(3, N)", "G.lastIndexOf(3, N)", "G.at(N)", "G[N]", "G[N & 3]", "G[N | 0]", "G[N >>> 0]", "G[Math.floor(N)]", "G[N + 1]", "G[N - 1]", "G[3 - N]", "N in G", "G.hasOwnProperty(N)", "G.find(e => e === N)", "G.findIndex(e => e === N)", "G.findLast(e => e <= N)", "G.findLastIndex(e => Object.is(e, N))", "G.some(e => e === N)", "G.every(e => e !== N)", "G.reduce((s, e) => s + e, N)", "G.reduceRight((s, e) => s - e, N)", "G.join(String(N))", "Math.max(...G, N)", "Math.min(N, ...G)", "elementOf(G, N)", "!new Array<number>(N).length", "new Array<number>(N & 7).length", "Array.from({ length: N & 7 }).length"];

const typedMakers = ["new K(4)", "new K(4)", "new K([1, 2, 3, 4])", "new K([N, 1, N, 2])", "K.of(N, 1, 2, 3)", "K.from([N, N, 1, 2])", "new K(new ArrayBuffer(32), 8, 3)", "new K((N & 3) + 2)"];
const typedChanges = ["t[0] = N;", "t[0] = N;", "t[1] = N;", "t[N & 1] = N;", "t[N] = 7;", "t.fill(N);", "t.fill(N, 1, 3);", "t.fill(7, N);", "t.set([N, N]);", "t.set([N], 1);", "t[0] += N;", "t[0]++;", "t[1] = t[0] + N;", "t.copyWithin(N & 1, 1);", "for (let i = 0; i < t.length; i++) t[i] = N + i;", "t.set(new Float64Array([N, 0.5]));", "t.set(new Int32Array([N]), 1);", "!t.set([1], N);", "t[0] = R;\n    t[1] = N;"];
const typedReads = ['out += num(t[0]) + "," + num(t[1]) + " ";', 'out += t.join() + " ";', 'out += t.indexOf(N) + "," + t.includes(N) + "," + t.lastIndexOf(N) + " ";', 'out += show(t.at(N)) + "," + show(t[N]) + " ";', 'out += t.subarray(N).length + "," + t.subarray(0, N).length + "," + t.slice(N).length + " ";', 'out += num(t.reduce((s, e) => s + e, N)) + " ";', 'out += t.map(e => e + N).join() + " ";', 'out += t.filter(e => e === N).length + "," + t.findIndex(e => e === N) + " ";', 'out += num(t[0] + t[1]) + "," + num(t[0] * 2) + " ";', 'out += (t[0] === N) + "," + (t[1] === R) + " ";'];
const views = ["Int8", "Uint8", "Int16", "Uint16", "Int32", "Uint32", "Float32", "Float64"];
const atomics = ["Atomics.store(w, 0, N)", "Atomics.add(w, N & 3, N)", "Atomics.sub(w, 1, N)", "Atomics.exchange(w, 1, N)", "Atomics.compareExchange(w, 0, 1, N)", "Atomics.compareExchange(w, 0, N, 5)", "Atomics.load(w, N & 3)", "!Atomics.load(w, N)", "Atomics.and(w, 0, N)", "Atomics.or(w, 0, N)", "Atomics.xor(w, 0, N)"];

// Expressions. `!` in front: it may throw.
const withText = ["text.charAt(N)", "text.charCodeAt(N)", "text.codePointAt(N)", "text.at(N)", "text[N]", "text[N & 7]", "text.slice(N)", "text.slice(0, N)", "text.slice(-N)", "text.substring(N, 4)", "text.substring(2, N)", "text.substr(N, 2)", "text.substr(1, N)", 'text.indexOf("c", N)', 'text.lastIndexOf("c", N)', 'text.includes("c", N)', 'text.startsWith("c", N)', 'text.endsWith("c", N)', 'text.padStart(N & 15, "-")', "text.padEnd(N & 15)", "text.repeat(N & 3)", '!"ab".repeat(N % 1000).length', "String.fromCharCode(N).charCodeAt(0)", "String.fromCharCode(65 + N).charCodeAt(0)", "String.fromCharCode(97 + (N & 15))", "String.fromCharCode(65 + (N & 7), N).length", "!String.fromCodePoint(N).length", "String.fromCodePoint(65 + (N & 7))", 'text.split("", N & 3)', 'text.split("", N).length', 'text.split("c", N)'];
const asText = ["N.toString()", "N.toString(2)", "N.toString(16)", "N.toString(36)", "(255).toString((N & 7) + 2)", "!(255).toString(N)", "!N.toString(N)", "N.toFixed(2)", "N.toFixed(0)", "(1.2345).toFixed(N & 3)", "!(1.5).toFixed(N)", "N.toPrecision(3)", "!(123.456).toPrecision(N)", "N.toExponential(2)", "!(123.456).toExponential(N)", '"" + N', "`${N}`", "String(N)", 'N + "x"', '"x" + N + "y" + N', "[N].join()", "[N, R].join(\"|\")", "JSON.stringify(N)", "JSON.stringify([N, R])", "JSON.stringify({ v: N })", "JSON.stringify({ [N]: 1 })", "JSON.stringify([1], null, N)", "parseInt(String(N), 10)", "parseFloat(String(N))", "parseInt(\"101\", (N & 7) + 2)", "parseInt(\"101\", N)", "String(N).length", "`${N}`.charCodeAt(0)", "N.toString().padStart(4, \"0\")"];
const mathematics = ["Math.abs(N)", "Math.floor(N)", "Math.ceil(N)", "Math.round(N)", "Math.trunc(N)", "Math.sign(N)", "Math.sqrt(N)", "Math.cbrt(N)", "Math.fround(N)", "Math.clz32(N)", "Math.imul(N, 3)", "Math.imul(N, N)", "Math.imul(65537, N)", "Math.min(N, 4)", "Math.max(N, 4)", "Math.min(N, -0)", "Math.max(N, -0)", "Math.min(N, R)", "Math.max(0, N)", "Math.min(0, N)", "Math.pow(N, 2)", "Math.pow(2, N)", "Math.pow(N, 0.5)", "Math.pow(N, -1)", "N ** 2", "2 ** N", "N ** N", "Math.hypot(N, 4)", "Math.atan2(N, 1)", "Math.atan2(N, -1)", "Math.atan2(0, N)", "Math.log2(N)", "Math.floor(N / 2)", "Math.floor(N / 3) * 3", "Math.round(N / 2)", "Math.round(N - 0.5)", "Math.ceil(N / 4)", "Math.ceil(-N / 4)", "Math.trunc(N / -2)", "Math.floor(-N)", "Math.abs(-N)", "Math.max(N)", "Math.min()  + N", "Math.floor(N + 0.5)", "Math.sign(-N)", "Math.round(-N / 4)"];
const operators = ["+N", "-N", "1 / N", "N % 3", "N % -3", "-N % 3", "N % 1", "N % N", "3 % N", "N / 3", "(N / 3) | 0", "N * 0", "N * -1", "N * -0", "N - N", "N + N", "N * N", "N * 2147483647", "N + 2147483647", "N - 2147483648", "N + 1", "N - 1", "N + 0.5", "N + -0", "N - 0", "0 - N", "N | 0", "N >>> 0", "N >> 1", "N << 1", "N << 31", "N >>> 31", "N >> 31", "~N", "~~N", "N & 255", "N & -1", "N ^ -1", "N ^ N", "N | N", "1 << N", "1 >>> N", "-1 >>> N", "-1 >> N", "N << N", "(N + 1) | 0", "(N * 3) | 0", "(N * N) | 0", "(N + N) >>> 0", "(N / 2) >>> 0", "(N | 0) + (N | 0)", "(N >>> 0) + 1", "(N >>> 0) * 2", "(N | 0) / 2", "(N | 0) % 4", "-(N | 0)", "-(N >>> 0)", "(N | 0) * (N | 0)", "((N | 0) * 65536) | 0", "N * 4294967296", "N / 4294967296", "N + 9007199254740991", "N - 9007199254740991", "N * 0.1", "N / 0", "-N / 0", "0 / N"];
const questions = ["Number.isInteger(N)", "Number.isSafeInteger(N)", "Number.isFinite(N)", "Number.isNaN(N)", "isNaN(N)", "isFinite(N)", "Number(N)", "Object.is(N, 0)", "Object.is(N, -0)", "Object.is(N, NaN)", "Object.is(N, 9)", "Object.is(N, R)", "Object.is(-N, R)", "N === 9", "N === 0", "N === -0", "N == 9", "N === R", "N == R", "N !== R", "N < R", "N <= R", "N >= R", "N < 4", "N <= 9", "N > 2147483647", "N >= -2147483648", "N < 4.5", "N !== N", "typeof N", "(!N)", "(!!N)", 'N ? "t" : "f"', "N || 7", "N && 7", "N < 10n", "N >= 9n", "N > -1n", "!BigInt(N)", "BigInt(N | 0)", "BigInt(N >>> 0)", "BigInt.asIntN(N & 63, 255n)", "BigInt.asUintN(N & 63, -1n)", "Number(BigInt(N | 0))", "Object(N) instanceof Number", "new Number(N).valueOf()", "Object(N) == N", "N.valueOf()", "N.constructor === Number", "[N] + \"\"", "structuredClone(N)", "new Date(N).getTime()", "!new Date(N).toISOString()", "Date.UTC(2020, 0, N)", "Date.UTC(2020, N & 7)", "new Date(0).setUTCSeconds(N)", "new Date(Date.UTC(2020, 0, 1, 0, 0, N)).getUTCMinutes()"];
const calls = ["twice(N)", "half(N)", "same(N)", "same<number>(N)", "sum(N, N, 1)", "sum(...[N, 2])", "sum(N)", "orSeven(N)", "deep(N, 3)", "twice.call(null, N)", "twice.apply(null, [N])", "twice.bind(null, N)()", "(() => N)()", "((x: number) => x + 1)(N)", "((x: number, y: number = N) => x + y)(1)", "((...r: number[]) => r[0])(N)", "((...r: number[]) => r.length)(N, N)", "new Point(N, N).x", "new Point(N, 0.5).x", "new Point(0.5, N).y", "[N].map(twice)[0]", "Reflect.apply(twice, null, [N])", "num(N)", "show(N)", "show([N])", "twice(twice(N))", "half(twice(N))", "same(same(N))", "same([N])[0]", "same({ v: N }).v", "elementOf([N], 0)", "elementOf([1, 2, 3], N)", "(function (x: number): number {\n      return arguments.length + x;\n    })(N)", "(function (x: number): unknown {\n      return arguments[0];\n    })(N)"];
const keyed = ["names.get(N)", "names.has(N)", "names.get(R)", "names.get(N | 0)", "names.get(-N)", "known.has(N)", "known.has(R)", "known.has(-N)", "known.has(N + 0.5)", "words[N]", "words[R]", "words[N | 0]", "N in words", "words.hasOwnProperty(N)", "Object.keys({ [N]: 1 })[0]", "Object.keys({ [N]: 1, [R]: 2 }).length", "Object.fromEntries([[N, 1]])[N]", "new Map([[N, 1]]).get(R)", "new Map([[R, 1]]).get(N)", "new Map([[N, 1], [R, 2]]).size", "new Set([N, R]).size", "new Set([N, -N]).size", "new Set([N]).has(R)", "new Set([N, 9, 9.0, 0, -0]).size", "[...new Set([N])][0]", "[...new Map([[N, N]])][0][1]", "Map.groupBy([N, R, 3], e => e).size", "Object.keys(Object.groupBy([N, R, 3], e => e)).join()"];

// Whole statements.
const blocks = [
  '{\n    const m = new Map<number, string>();\n    m.set(N, "a");\n    m.set(R, "b");\n    out += m.size + show(m.get(N)) + show(m.get(9)) + show([...m.keys()]) + " ";\n  }',
  '{\n    const m = new Map<number, number>();\n    for (let i = 0; i < 3; i++) m.set(N + i, (m.get(N + i) ?? 0) + N);\n    out += m.size + "," + show(m.get(N)) + "," + show(m.get(R + 1)) + "," + m.delete(N) + m.has(R) + " ";\n  }',
  '{\n    const s = new Set<number>([0, 3, 9, 4.5]);\n    out += s.has(N);\n    s.add(N);\n    out += s.size + "," + s.delete(R) + s.size + " ";\n  }',
  '{\n    const s = new Set<number>();\n    s.add(N);\n    s.add(R);\n    s.add(-N);\n    out += s.size + show([...s]) + " ";\n  }',
  '{\n    const o = { x: 1, y: 2 };\n    o.x = N;\n    out += num(o.x) + "," + num(o.y) + "," + num(o.x + o.y) + " ";\n  }',
  '{\n    const o = { x: N, y: 0.5 };\n    out += num(o.x) + ",";\n    o.y = N;\n    o.x = 0.5;\n    out += num(o.x) + "," + num(o.y) + " ";\n  }',
  '{\n    const o = new Point(N, 2);\n    o.y += N;\n    out += num(o.x) + "," + num(o.y) + " ";\n  }',
  '{\n    const o = new Point(1, 2);\n    o.x = N;\n    o.y = o.x + 1;\n    o.x++;\n    out += num(o.x) + "," + num(o.y) + " ";\n  }',
  '{\n    const c = new Cell();\n    c.value = N;\n    out += num(c.value) + "," + num(c.value + 1) + " ";\n  }',
  '{\n    const o: { x: number; y?: number } = { x: N };\n    o.y = R;\n    out += num(o.x) + "," + show(o.y) + " ";\n  }',
  '{\n    const o: Record<string, number> = {};\n    o.k = N;\n    o["k" + N] = N;\n    out += Object.keys(o).join() + num(o.k) + " ";\n  }',
  '{\n    const o: Record<number, number> = {};\n    o[N] = N;\n    out += Object.keys(o).join() + show(o[N]) + show(o[R]) + " ";\n  }',
  '{\n    const os = [new Point(N, 1), new Point(0.5, N)];\n    out += num(os[0].x + os[1].y) + "," + num(os[1].x) + " ";\n  }',
  '{\n    const { x, y } = new Point(N, R);\n    out += num(x) + "," + num(y) + "," + (x === y) + " ";\n  }',
  '{\n    const o = { ...{ x: N }, y: 1 };\n    out += num(o.x) + " ";\n  }',
  '{\n    const o = Object.freeze({ x: N, y: [N] });\n    out += num(o.x) + "," + num(o.y[0]) + " ";\n  }',
  '{\n    const pair: [number, string] = [N, "t"];\n    out += num(pair[0]) + pair[1] + " ";\n  }',
  '{\n    const mixed: (number | string)[] = ["s"];\n    mixed.push(N);\n    mixed[0] = N;\n    out += show(mixed[0]) + show(mixed[1]) + " ";\n  }',
  '{\n    const [x = N, y = R] = [] as number[];\n    out += num(x) + "," + num(y) + " ";\n  }',
  'shared = N;\n  out += num(shared) + "," + num(shared + 1) + " ";',
  'Cell.last = N;\n  out += num(Cell.last) + " ";',
  'list.push(N);\n  out += list.length + ":" + num(list[list.length - 1]) + "," + num(list[0]) + " ";',
  'list.push(N);\n  list.push(R);\n  out += num(list[list.length - 2]) + "," + num(list[list.length - 1]) + " ";',
  'home.v = N;\n  out += num(home.v) + "," + num(home.w) + " ";',
  'home.w = N;\n  out += num(home.v + home.w) + " ";',
  'floats[1] = N;\n  ints[1] = N;\n  bytes[1] = N;\n  wide[1] = N;\n  out += num(floats[1]) + "," + num(ints[1]) + "," + num(bytes[1]) + "," + num(wide[1]) + " ";',
  'switch (N) {\n    case 0:\n      out += "zero ";\n      break;\n    case 3:\n      out += "three ";\n      break;\n    case 9:\n      out += "nine ";\n      break;\n    case 4.5:\n      out += "half ";\n      break;\n    case -1:\n      out += "minus ";\n      break;\n    case 2147483647:\n      out += "most ";\n      break;\n    default:\n      out += "other ";\n  }',
  'switch (N) {\n    case 0:\n      out += "0 ";\n      break;\n    case 1:\n      out += "1 ";\n      break;\n    case 2:\n      out += "2 ";\n      break;\n    case 3:\n      out += "3 ";\n      break;\n    case 4:\n      out += "4 ";\n      break;\n    case 5:\n      out += "5 ";\n      break;\n    case 6:\n      out += "6 ";\n      break;\n    case 7:\n      out += "7 ";\n      break;\n    default:\n      out += "far ";\n  }',
  'switch (N | 0) {\n    case 0:\n      out += "0 ";\n      break;\n    case 3:\n      out += "3 ";\n      break;\n    case 9:\n      out += "9 ";\n      break;\n    case -1:\n      out += "-1 ";\n      break;\n    default:\n      out += "far ";\n  }',
  'if (N === 0) out += "zero ";\n  else if (N === 3) out += "three ";\n  else if (N === 9) out += "nine ";\n  else if (N === 12) out += "twelve ";\n  else out += "other ";',
  'for (let i = 0; i < N && i < 5; i++) out += i;\n  out += " ";',
  'for (let i = N, k = 0; k < 3; i++, k++) out += num(i) + ",";\n  out += " ";',
  'for (let i = N, k = 0; k < 3; i--, k++) out += num(i) + ",";\n  out += " ";',
  'for (let i = N, k = 0; k < 3; i += 0.5, k++) out += num(i) + ",";\n  out += " ";',
  'for (let i = N, k = 0; k < 3 && i < N + 3; i += 1, k++) out += show([10, 20, 30, 40][i]) + ",";\n  out += " ";',
  'for (let i = 0; i < (N & 3); i++) out += num(N - i) + ",";\n  out += " ";',
  '{\n    let c = N;\n    c++;\n    out += num(c) + ",";\n    c -= 2;\n    out += num(c) + ",";\n    c = -c;\n    out += num(c) + " ";\n  }',
  '{\n    let c = N;\n    const was = c++;\n    const now = ++c;\n    out += num(was) + "," + num(now) + "," + num(c--) + "," + num(--c) + " ";\n  }',
  '{\n    let c = N;\n    c |= 0;\n    out += num(c) + ",";\n    c = N;\n    c >>>= 0;\n    out += num(c) + ",";\n    c = N;\n    c **= 2;\n    out += num(c) + " ";\n  }',
  '{\n    const read = () => N;\n    const more = (by: number) => N + by;\n    out += num(read()) + "," + num(more(1)) + "," + num(more(0.5)) + " ";\n  }',
  '{\n    const v = new DataView(new ArrayBuffer(16));\n    v.setV1(0, N);\n    out += num(v.getV1(0)) + "," + num(v.getV2(0)) + " ";\n  }',
  '{\n    const v = new DataView(new ArrayBuffer(16));\n    v.setV3(N & 7, 258, true);\n    out += num(v.getV3(N & 7, true)) + "," + num(v.getUint8(N & 7)) + " ";\n  }',
  'try {\n    const v = new DataView(new ArrayBuffer(16));\n    v.setV1(N, 7);\n    out += num(v.getV1(N)) + " ";\n  } catch (error) {\n    out += "!" + (error as Error).name + " ";\n  }',
  'try {\n    if (N === N) throw N;\n    out += "not thrown ";\n  } catch (error) {\n    out += show(error) + " ";\n  }',
  'try {\n    out += num(N) + ",";\n    twice(N);\n  } finally {\n    out += num(N + 1) + " ";\n  }',
];

export function generate(random: Random): string {
  const notes: string[] = [];
  const text: string[] = [prelude];
  const run: string[] = [];
  const functions = random.between(6, 12);
  for (let id = 1; id <= functions; id++) {
    const form = random.weighted([[7, "function"], [2, "generator"], [2, "async"], [1, "method"], [1, "arrow"]] as const);
    const other = random.chance(0.25) ? random.pick(others) : undefined;
    const isAnything = !other && random.chance(0.05);
    const isNarrowed = !!other || isAnything;
    const hasClosure = !isNarrowed && random.chance(0.12);
    // Where the variable may hold something else, a constant stands for it behind the test for a number.
    const name = isNarrowed ? "n" : "a";
    const road = () => random.pick(roads).replace(/\bN\b/g, name);
    const written = (template: string): string =>
      template
        .replace(/\bG\b/g, () => random.pick(fullLists))
        .replace(/\bF\b/g, () => random.pick(freshLists))
        // The engine's own search of a Uint8ClampedArray takes 256 for 0, and its search of a Float32Array answers by how the number is kept: there is nothing to compare with.
        .replace(/\bK\b/g, random.pick(/\bt\.(indexOf|includes|lastIndexOf)\(/.test(template) ? kinds.filter(kind => kind !== "Uint8ClampedArray" && kind !== "Float32Array") : kinds))
        .replace(/V1\b/g, random.pick(views))
        .replace(/V2\b/g, random.pick(views))
        .replace(/V3\b/g, random.pick(views.slice(2)))
        .replace(/\bR\b/g, road)
        .replace(/\bN\b/g, name);
    const guarded = (statement: string) => `try {\n    ${statement}\n  } catch (error) {\n    out += "!" + (error as Error).name + " ";\n  }`;
    // An expression is printed; what may throw stands in a try, and now and then what does not.
    const printed = (expression: string, isNumber: boolean): string => {
      const mayThrow = expression.startsWith("!");
      const statement = `out += ${isNumber && random.chance(0.5) ? "num" : "show"}(${mayThrow ? expression.slice(1) : expression}) + " ";`;
      return written(mayThrow || random.chance(0.06) ? guarded(statement) : statement);
    };
    const statements = (all: string[]): string => {
      const mayThrow = all.some(each => each.startsWith("!"));
      const body = all.map(each => (each.startsWith("!") ? each.slice(1) : each)).join("\n    ");
      return written(mayThrow ? guarded(body) : `{\n    ${body}\n  }`);
    };
    const use = (): string =>
      random.weighted([
        [10, () => statements(["const l: number[] = F;", random.pick(listChanges), random.pick(listReads)])],
        [3, () => statements(["const l: number[] = F;", random.pick(listChanges), random.pick(listChanges), random.pick(listReads), random.pick(listReads)])],
        [2, () => statements(["const l: number[] = F;", random.pick(farChanges), random.pick(farReads)])],
        [6, () => statements([`const m: number[] = ${random.pick(newLists).replace(/^!/, "")};`, "!", random.pick(listReads).replace(/\bl\b/g, "m")])],
        [5, () => printed(random.pick(fromLists), false)],
        [7, () => statements([`const t = ${random.pick(typedMakers)};`, random.pick(typedChanges), random.pick(typedReads)])],
        [2, () => statements(["const w = new Int32Array([1, 2, 3, 4]);", `out += show(${random.pick(atomics).replace(/^!/, "")}) + ",";`, "!", 'out += w.join() + " ";'])],
        [5, () => printed(random.pick(withText), false)],
        [5, () => printed(random.pick(asText), false)],
        [6, () => printed(random.pick(mathematics), true)],
        [8, () => printed(random.pick(operators), true)],
        [6, () => printed(random.pick(questions), false)],
        [5, () => printed(random.pick(calls), false)],
        [6, () => printed(random.pick(keyed), false)],
        [12, () => written(random.pick(blocks))],
        [form === "generator" ? 4 : 0, () => written('{\n    const back: unknown = yield N;\n    out += show(back) + " ";\n  }')],
        [form === "async" ? 4 : 0, () => written(random.pick(['out += num(await N) + " ";', 'out += num(await Promise.resolve(N)) + " ";', 'await null;\n  out += num(N) + " ";', '{\n    const [x, y] = await Promise.all([N, R]);\n    out += num(x) + "," + num(y) + " ";\n  }']))],
      ] as const)();
    const uses = (count: number): string => {
      let all = Array.from({ length: count }, use).join("\n  ");
      if (random.chance(0.3)) all = `if (${written(random.pick(tests))}) {\n  ${all}\n  } else out += "- ";`;
      return isNarrowed ? `if (typeof a === "number") {\n  const n = a;\n  ${all}\n  } else out += typeof a + " ";` : all;
    };
    const advance = (): string => {
      const step = hasClosure && random.chance(0.5) ? "bump();" : random.pick(advances);
      if (!isNarrowed) return step;
      return `if (typeof a === "number") {\n  ${step}\n  } else a = ${random.pick(["3", "9", "0.5", "p"])};${other && random.chance(0.4) ? `\n  if (turns === ${random.between(2, 4)}) a = ${other[1]};` : ""}`;
    };
    const start = random.pick(starts);
    const declared = other ? `let a: number | ${other[0]} = p > 1e300 ? ${other[1]} : ${start};` : isAnything ? `let a: unknown = ${start};` : `let a: number = ${start};`;
    const early = !isNarrowed && random.chance(0.35) ? `\n  ${random.pick(["a += 6;", "a += 1;", "a *= 2;", "a -= 3;", "a = a + p;", "a /= 1;", "a = -a;"])}` : "";
    const stop = form === "generator" ? "\n  yield 0;" : form === "async" ? "\n  await null;" : "";
    const loop = random.weighted([
      [6, () => `for (let x = ${random.pick(["0", "1", "p"])}; x < ${random.pick(["2", "3", "4", "p + 3"])} && turns++ < 6; x++) {\n  ${random.chance(0.5) ? `${advance()}\n  ${uses(random.between(1, 2))}` : `${uses(random.between(1, 2))}\n  ${advance()}`}${random.chance(0.3) ? stop : ""}\n  }`],
      [2, () => `for (let x = 0; turns++ < ${random.between(2, 5)}; x += 0.5) {\n  ${uses(1)}\n  ${advance()}\n  }`],
      [2, () => `{\n  const x = turns;\n  if (${random.pick(["p > q", "p === 3", "q !== q", "p < q"])}) {\n  ${advance()}\n  }\n  }`],
      [1, () => `for (let x = 0; x < 2 && turns++ < 6; x++) {\n  ${advance()}\n  }`],
      [1, () => ""],
    ] as const)();
    let body = `${declared}${early}${hasClosure ? `\n  const bump = (): void => {\n    ${random.pick(["a += q;", "a += 0.5;", "a *= 2;", "a = a / 2;", "a++;"])}\n  };` : ""}
  ${random.chance(0.8) ? uses(random.between(1, 3)) : ""}${random.chance(0.3) ? stop : ""}
  ${loop}
  ${random.chance(0.6) ? uses(random.between(1, 2)) : ""}
  return out + show(a);`;
    // Only what the body names is made.
    const made = [
      ["text", 'const text: string = "abcdefghij";'],
      ["floats", "const floats = new Float64Array([p, 9, 0.5, q]);"],
      ["ints", "const ints = new Int32Array([p, 9, -1, q]);"],
      ["bytes", "const bytes = new Uint8Array([p, 9, 255, q]);"],
      ["wide", "const wide = new Uint32Array([p, 4294967295, 9, q]);"],
      ["home", "const home = { v: p, w: 0.5 };"],
      ["cell", "const cell = new Cell();\n  cell.value = p;"],
      ["list", "const list: number[] = [];"],
    ].filter(([word]) => new RegExp(`\\b${word}\\b`).test(body));
    body = `let out = "";\n  let turns = 0;\n  ${made.map(each => each[1]).join("\n  ")}${made.length ? "\n  " : ""}${body}`;

    const value = () => random.weighted([[10, () => random.pick(["3", "3", "9", "0", "1", "2", "4", "6", "7", "8", "12", "60"])], [3, () => random.pick(["0.5", "4.5", "1.5", "-0.5", "2.25"])], [2, () => random.pick(["-1", "-3", "-9"])], [3, () => random.pick(["2147483640", "2147483647", "-2147483648", "2147483648", "4294967295", "4294967296", "65536", "100000", "1000000000", "9007199254740991", "255", "256", "31", "32", "64"])], [1, () => random.pick(["-0", "NaN", "Infinity", "-Infinity"])], [3, () => `given[${random.below(8)}]`]] as const)();
    const times = random.weighted([[5, 1], [4, 2], [1, 3]] as const);
    notes.push(`${form}${other ? "-or-" + other[0] : isAnything ? "-anything" : ""}${hasClosure ? "-closure" : ""}`);
    for (let time = 0; time < times; time++) {
      const given = `${value()}, ${value()}`;
      if (form === "function" || form === "arrow") run.push(`console.log("${id}: " + run${id}(${given}));`);
      else if (form === "method") run.push(`console.log("${id}: " + new Home${id}().run(${given}));`);
      else if (form === "async") run.push(`console.log("${id}: " + (await run${id}(${given})));`);
      else run.push(`{\n  const steps = run${id}(${given});\n  let result = steps.next();\n  for (let i = 0; i < 60 && !result.done; i++) result = steps.next(result.value);\n  console.log("${id}: " + result.value);\n}`);
    }
    if (form === "function") text.push(`function run${id}(p: number, q: number): string {\n  ${body}\n}`);
    else if (form === "arrow") text.push(`const run${id} = (p: number, q: number): string => {\n  ${body}\n};`);
    else if (form === "method") text.push(`class Home${id} {\n  run(p: number, q: number): string {\n  ${body}\n  }\n}`);
    else if (form === "async") text.push(`async function run${id}(p: number, q: number): Promise<string> {\n  ${body}\n}`);
    else text.push(`function* run${id}(p: number, q: number): Generator<number, string, unknown> {\n  ${body}\n}`);
  }
  text.push(run.join("\n"));
  return `// ${notes.join(" ")}\n${text.join("\n")}`;
}
