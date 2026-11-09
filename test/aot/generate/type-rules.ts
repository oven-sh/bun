// The programs of type-rules that are mostly a table written out: blocks of lines that differ in a few places.
import { programsOf, text } from "../generate";

export const programs = () =>
  programsOf({
    "only-a-false-value-enters-a-function.ts": text(
      `// A function that only a value of another type than its parameter ever enters: the call throws a TypeError at the parameter, whatever the body, which never runs, does with the parameter.
function describe(error: unknown): string {
  if (!(error instanceof Error)) return "thrown: " + String(error);
  const e = error;
  const message = e.message.split("\\n")[0].replace(/ \\(bun compile[^)]*\\)/, "");
  // The text of an error of the language is not the subject here.
  if (!/(^|: )expected /.test(message)) return e.name;
  const position = message.includes(", got ") ? /:(\\d+):(\\d+)\\)?\\s*$/m.exec(e.stack ?? "") : null;
  return e.name + ": " + message + (position ? " | " + position[1] + ":" + position[2] : "");
}
async function attempt(name: string, f: () => unknown): Promise<void> {
  try { console.log(name, "|", "no error:", String(await f())); } catch (error) { console.log(name, "|", describe(error)); }
}
let kept: unknown;`,
      [
        `n: number) { return String(n)	string-call", () => entered("4"	s: string) { return Number(s)	number-call", () => entered(5	n: number) { return Boolean(n)	boolean-call", () => entered("4"	n: number) { return BigInt(n)	bigint-call", () => entered("4"
s: string) { return Symbol(s)	symbol-call", () => entered(5	n: number) { return Object(n)	object-call", () => entered("4"	n: number) { return Array(n)	array-call", () => entered("4"	n: number) { return new Array(n)	new-array", () => entered("4"
n: number) { return new Date(n)	new-date", () => entered("4"	a: [string, number][]) { return new Map(a)	new-map", () => entered(5	a: number[]) { return new Set(a)	new-set", () => entered(5	s: string) { return new Error(s)	new-error", () => entered(5
s: string) { return new RegExp(s)	new-regexp", () => entered(5	f: (r: (v: number) => void) => void) { return new Promise(f)	new-promise", () => entered(5	o: { a: number }) { return new Proxy(o, {})	new-proxy", () => entered(5	n: number) { return new Uint8Array(n)	new-uint8array", () => entered("4"
a: [object, number][]) { return new WeakMap(a)	new-weak-map", () => entered(5	s: string) { return new URL(s)	new-url", () => entered(5	n: number) { return Math.max(n, 1)	math-max", () => entered("4"	n: number) { return Math.floor(n)	math-floor", () => entered("4"
n: number) { return Math.abs(n)	math-abs", () => entered("4"	n: number) { return Math.pow(n, 2)	math-pow", () => entered("4"	s: string) { return parseInt(s)	parse-int", () => entered(5	s: string) { return parseFloat(s)	parse-float", () => entered(5
n: number) { return isNaN(n)	is-nan", () => entered("4"	n: number) { return Number.isInteger(n)	number-is-integer", () => entered("4"	o: { a: number }) { return JSON.stringify(o)	json-stringify", () => entered(5	s: string) { return JSON.parse(s)	json-parse", () => entered(5
o: { a: number }) { return Object.keys(o)	object-keys", () => entered(5	o: { a: number }) { return Object.entries(o)	object-entries", () => entered(5	o: { a: number }) { return Object.assign({}, o)	object-assign", () => entered(5	o: { a: number }) { return Object.freeze(o)	object-freeze", () => entered(5
o: { a: number }) { return Object.create(o)	object-create", () => entered(5	o: { a: number }) { return Object.getPrototypeOf(o)	object-get-prototype-of", () => entered(5	o: { a: number }) { return Object.defineProperty(o, "b", { value: 1 })	object-define-property", () => entered(5	a: [string, number][]) { return Object.fromEntries(a)	object-from-entries", () => entered(5
o: { a: number }) { return Reflect.ownKeys(o)	reflect-own-keys", () => entered(5	o: { a: number }) { return Reflect.get(o, "a")	reflect-get", () => entered(5	f: () => number) { return Reflect.apply(f, null, [])	reflect-apply", () => entered(5	a: number[]) { return Array.isArray(a)	array-is-array", () => entered(5
a: number[]) { return Array.from(a)	array-from", () => entered(5	n: number) { return Array.of(n)	array-of", () => entered("4"	n: number) { return [1].push(n)	array-push", () => entered("4"	n: number) { return [1].includes(n)	array-includes", () => entered("4"
n: number) { return [1].indexOf(n)	array-index-of", () => entered("4"	a: number[]) { return [1].concat(a)	array-concat", () => entered(5	f: (n: number) => number) { return [1].map(f)	array-map", () => entered(5	f: (n: number) => void) { return [1].forEach(f)	array-for-each", () => entered(5
f: (n: number) => boolean) { return [1].filter(f)	array-filter", () => entered(5	f: (a: number, b: number) => number) { return [1, 2].reduce(f)	array-reduce", () => entered(5	f: (a: number, b: number) => number) { return [2, 1].sort(f)	array-sort", () => entered(5	f: (n: number) => boolean) { return [1].find(f)	array-find", () => entered(5
s: string) { return [1, 2].join(s)	array-join", () => entered(5	n: number) { return [1, 2].slice(n)	array-slice", () => entered("4"	n: number) { return [1, 2].fill(n)	array-fill", () => entered("4"	n: number) { return [1, 2].at(n)	array-at", () => entered("4"
a: number[]) { return a.map(x => x)	own-array-map", () => entered(5	a: number[]) { return a.length	own-array-length", () => entered(5	a: number[]) { return [...a]	own-array-spread", () => entered(5	a: number[]) { return (() => { let t = 0; for (const x of a) t += x; return t; })()	own-array-for-of", () => entered(5
s: string) { return "a".concat(s)	string-concat", () => entered(5	s: string) { return "a".includes(s)	string-includes", () => entered(5	s: string) { return "a,b".split(s)	string-split", () => entered(5	s: string) { return "a".replace("a", s)	string-replace", () => entered(5
n: number) { return "a".repeat(n)	string-repeat", () => entered("4"	n: number) { return "a".charAt(n)	string-char-at", () => entered("4"	n: number) { return "a".padStart(n)	string-pad-start", () => entered("4"	n: number) { return String.fromCharCode(n)	string-from-char-code", () => entered("4"
s: string) { return s.toUpperCase()	own-string-method", () => entered(5	s: string) { return s.length	own-string-length", () => entered(5	s: string) { return s[0]	own-string-index", () => entered(5	s: string) { return \`<\${s}>\`	own-string-template", () => entered(5
n: number) { return n.toFixed(1)	number-to-fixed", () => entered("4"	n: number) { return n.toString()	number-to-string", () => entered("4"	n: number) { return (1.5).toFixed(n)	to-fixed-argument", () => entered("4"	n: number) { return new Map<string, number>().set("a", n)	map-set", () => entered("4"
s: string) { return new Map<string, number>().get(s)	map-get", () => entered(5	n: number) { return new Set<number>().add(n)	set-add", () => entered("4"	n: number) { return new Set<number>().has(n)	set-has", () => entered("4"	n: number) { return Promise.resolve(n)	promise-resolve", () => entered("4"
f: (n: number) => number) { return Promise.resolve(1).then(f)	promise-then", () => entered(5	a: Promise<number>[]) { return Promise.all(a)	promise-all", () => entered(5	f: () => void) { return clearTimeout(setTimeout(f, 0))	set-timeout", () => entered(5	f: () => void) { return queueMicrotask(f)	queue-microtask", () => entered(5
o: { a: number }) { return structuredClone(o)	structured-clone", () => entered(5	f: () => number) { return f.call(null)	function-call", () => entered(5	f: () => number) { return f.apply(null, [])	function-apply", () => entered(5	f: () => number) { return f.bind(null)	function-bind", () => entered(5
f: () => number) { return f()	call-argument", () => entered(5	c: new () => object) { return new c()	new-argument", () => entered(5	n: number) { return ((v: unknown) => typeof v)(n)	closure-call", () => entered("4"	n: number) { return typeof n	typeof", () => entered("4"
n: number) { return n + 1	add", () => entered("4"	n: number) { return n < 1	compare", () => entered("4"	n: number) { return n === 1	strict-equal", () => entered("4"	n: number) { return -n	negate", () => entered("4"
n: number) { return !n	not", () => entered("4"	o: { a: number }) { return "a" in o	in", () => entered(5	o: { a: number }) { return o instanceof Object	instanceof", () => entered(5	c: new () => object) { return ({}) instanceof c	instanceof-right", () => entered(5
o: { a: number }) { return o.a	read", () => entered(5	o: { a: number }) { return (o.a = 1)	store", () => entered(5	o: { a: number }) { return ({ ...o })	spread-object", () => entered(5	o: { a: number }) { return (() => { const { a } = o; return a; })()	destructure", () => entered(5
n: number) { return ({ n })	literal", () => entered("4"	n: number) { return [n]	array-literal", () => entered("4"	n: number) { return n	return", () => entered("4"	n: number) { return (() => n)()	capture", () => entered("4"
n: number) { return (kept = n)	store-variable", () => entered("4"	n: number) { return (async () => await n)()	await", () => entered("4"	n: number) { return (() => { throw n; })()	throw", () => entered("4"	n: number) { return (() => { switch (n) { case 1: return "one"; default: return "other"; } })()	switch", () => entered("4"
n: number) { return (() => { let t = 0; for (let i = 0; i < n; i++) t += i; return t; })()	loop", () => entered("4"	s: string) { return Buffer.from(s)	buffer-from", () => entered(5	s: string) { return new TextEncoder().encode(s)	text-encoder", () => entered(5	o: { a: number }) { return Bun.inspect(o)	bun-inspect", () => entered(5`,
        (n, a, b, c, d, e, f, g, h) => `{
  function entered(${a}; }
  await attempt("${b} as any));
}
{
  function entered(${c}; }
  await attempt("${d} as any));
}
{
  function entered(${e}; }
  await attempt("${f} as any));
}
{
  function entered(${g}; }
  await attempt("${h} as any));
}`,
      ],
      `{
  function entered(f: () => void) { return process.nextTick(f); }
  await attempt("process-next-tick", () => entered(5 as any));
}
{
  function entered(n: number) { console.log(n); }
  await attempt("console-log", () => entered("4" as any));
}
console.log("after", typeof kept);
export {};
`,
    ),
    "untyped-objects-into-large-unions.ts": text(
      `// Values enter unions of many types. A hundred and twenty record types, and fourteen unions that each take sixteen of them, crossing one another so that no numbering of the types
// makes every union a row. Records of other kinds get into the arrays through an alias of a wider element type: the test of a read asks only for an object, so every record passes, and \`id\`, which all of them have, is read from each.`,
      [
        `Root { id
Kind10 extends Root { field10
Kind21 extends Root { field21
Kind32 extends Root { field32
Kind43 extends Root { field43
Kind54 extends Root { field54
Kind65 extends Root { field65
Kind76 extends Root { field76
Kind87 extends Root { field87
Kind98 extends Root { field98
Kind109 extends Root { field109`,
        (n, a) => `interface ${a}: number }
interface Kind${11 * n} extends Root { field${11 * n}: number }
interface Kind${11 * n + 1} extends Root { field${11 * n + 1}: number }
interface Kind${11 * n + 2} extends Root { field${11 * n + 2}: number }
interface Kind${11 * n + 3} extends Root { field${11 * n + 3}: number }
interface Kind${11 * n + 4} extends Root { field${11 * n + 4}: number }
interface Kind${11 * n + 5} extends Root { field${11 * n + 5}: number }
interface Kind${11 * n + 6} extends Root { field${11 * n + 6}: number }
interface Kind${11 * n + 7} extends Root { field${11 * n + 7}: number }
interface Kind${11 * n + 8} extends Root { field${11 * n + 8}: number }
interface Kind${11 * n + 9} extends Root { field${11 * n + 9}: number }`,
      ],
      `type Union0 = Kind4 | Kind6 | Kind7 | Kind9 | Kind12 | Kind19 | Kind27 | Kind41 | Kind46 | Kind50 | Kind64 | Kind68 | Kind74 | Kind83 | Kind105 | Kind116;
type Union1 = Kind7 | Kind8 | Kind11 | Kind15 | Kind28 | Kind30 | Kind50 | Kind53 | Kind54 | Kind55 | Kind70 | Kind72 | Kind73 | Kind74 | Kind80 | Kind105;
type Union2 = Kind5 | Kind6 | Kind15 | Kind17 | Kind18 | Kind23 | Kind28 | Kind37 | Kind39 | Kind53 | Kind69 | Kind71 | Kind73 | Kind87 | Kind104 | Kind109;
type Union3 = Kind7 | Kind8 | Kind12 | Kind13 | Kind24 | Kind26 | Kind47 | Kind63 | Kind70 | Kind72 | Kind73 | Kind74 | Kind79 | Kind81 | Kind87 | Kind91;
type Union4 = Kind10 | Kind23 | Kind31 | Kind38 | Kind40 | Kind46 | Kind54 | Kind58 | Kind59 | Kind68 | Kind73 | Kind74 | Kind89 | Kind99 | Kind101 | Kind118;
type Union5 = Kind9 | Kind15 | Kind19 | Kind21 | Kind36 | Kind38 | Kind43 | Kind53 | Kind57 | Kind63 | Kind65 | Kind67 | Kind77 | Kind93 | Kind96 | Kind112;
type Union6 = Kind5 | Kind9 | Kind40 | Kind43 | Kind44 | Kind53 | Kind62 | Kind71 | Kind73 | Kind85 | Kind88 | Kind97 | Kind101 | Kind104 | Kind112 | Kind119;
type Union7 = Kind7 | Kind8 | Kind11 | Kind34 | Kind39 | Kind58 | Kind60 | Kind63 | Kind74 | Kind76 | Kind82 | Kind85 | Kind89 | Kind93 | Kind102 | Kind107;
type Union8 = Kind2 | Kind14 | Kind21 | Kind36 | Kind44 | Kind45 | Kind49 | Kind57 | Kind59 | Kind73 | Kind78 | Kind85 | Kind87 | Kind91 | Kind105 | Kind113;
type Union9 = Kind7 | Kind10 | Kind16 | Kind21 | Kind27 | Kind31 | Kind36 | Kind50 | Kind51 | Kind57 | Kind63 | Kind70 | Kind94 | Kind98 | Kind111 | Kind117;
type Union10 = Kind10 | Kind17 | Kind19 | Kind22 | Kind29 | Kind35 | Kind45 | Kind48 | Kind53 | Kind55 | Kind70 | Kind87 | Kind90 | Kind104 | Kind110 | Kind113;
type Union11 = Kind0 | Kind1 | Kind18 | Kind19 | Kind23 | Kind29 | Kind33 | Kind36 | Kind47 | Kind53 | Kind62 | Kind68 | Kind75 | Kind78 | Kind84 | Kind106;
type Union12 = Kind6 | Kind16 | Kind40 | Kind58 | Kind65 | Kind72 | Kind79 | Kind83 | Kind86 | Kind87 | Kind88 | Kind94 | Kind99 | Kind109 | Kind111 | Kind115;
type Union13 = Kind7 | Kind8 | Kind13 | Kind14 | Kind20 | Kind24 | Kind26 | Kind43 | Kind50 | Kind51 | Kind56 | Kind61 | Kind71 | Kind76 | Kind81 | Kind102;`,
      [
        `describe(root: Root | undefined): string { return root ? Object.keys(root).join() + ":" + Object.values(root).join() : "nothing"	4 = { id: 4, field4: 0 }; listOfUnion0	6 = { id: 6, field6: 1 }; listOfUnion0	7 = { id: 7, field7: 2 }; listOfUnion0.push(made); } listOfUnion0	9 = { id: 9, field9: 3 }; listOfUnion0	12 = { id: 12, field12: 4 }; listOfUnion0	19 = { id: 19, field19: 5 }; listOfUnion0	27 = { id: 27, field27: 6 }; listOfUnion0	41 = { id: 41, field41: 7 }; listOfUnion0.push(made); } listOfUnion0	46 = { id: 46, field46: 8 }; listOfUnion0	50 = { id: 50, field50: 9 }; listOfUnion0	64 = { id: 64, field64: 10 }; listOfUnion0	68 = { id: 68, field68: 11 }; listOfUnion0	74 = { id: 74, field74: 12 }; listOfUnion0.push(made); } listOfUnion0	83 = { id: 83, field83: 13 }; listOfUnion0	105 = { id: 105, field105: 14 }; listOfUnion0	116 = { id: 116, field116: 15 }; listOfUnion0
sumOfUnion0(): number { let sum = 0; for (let i = 0; i < listOfUnion0.length; i++) { const held: Union0 | undefined = listOfUnion0[i]; if (held) sum += held.id; else sum -= 1; } return sum	7 = { id: 7, field7: 0 }; listOfUnion1	8 = { id: 8, field8: 1 }; listOfUnion1	11 = { id: 11, field11: 2 }; listOfUnion1.push(made); } listOfUnion1	15 = { id: 15, field15: 3 }; listOfUnion1	28 = { id: 28, field28: 4 }; listOfUnion1	30 = { id: 30, field30: 5 }; listOfUnion1	50 = { id: 50, field50: 6 }; listOfUnion1	53 = { id: 53, field53: 7 }; listOfUnion1.push(made); } listOfUnion1	54 = { id: 54, field54: 8 }; listOfUnion1	55 = { id: 55, field55: 9 }; listOfUnion1	70 = { id: 70, field70: 10 }; listOfUnion1	72 = { id: 72, field72: 11 }; listOfUnion1	73 = { id: 73, field73: 12 }; listOfUnion1.push(made); } listOfUnion1	74 = { id: 74, field74: 13 }; listOfUnion1	80 = { id: 80, field80: 14 }; listOfUnion1	105 = { id: 105, field105: 15 }; listOfUnion1
sumOfUnion1(): number { let sum = 0; for (let i = 0; i < listOfUnion1.length; i++) { const held: Union1 | undefined = listOfUnion1[i]; if (held) sum += held.id; else sum -= 1; } return sum	5 = { id: 5, field5: 0 }; listOfUnion2	6 = { id: 6, field6: 1 }; listOfUnion2	15 = { id: 15, field15: 2 }; listOfUnion2.push(made); } listOfUnion2	17 = { id: 17, field17: 3 }; listOfUnion2	18 = { id: 18, field18: 4 }; listOfUnion2	23 = { id: 23, field23: 5 }; listOfUnion2	28 = { id: 28, field28: 6 }; listOfUnion2	37 = { id: 37, field37: 7 }; listOfUnion2.push(made); } listOfUnion2	39 = { id: 39, field39: 8 }; listOfUnion2	53 = { id: 53, field53: 9 }; listOfUnion2	69 = { id: 69, field69: 10 }; listOfUnion2	71 = { id: 71, field71: 11 }; listOfUnion2	73 = { id: 73, field73: 12 }; listOfUnion2.push(made); } listOfUnion2	87 = { id: 87, field87: 13 }; listOfUnion2	104 = { id: 104, field104: 14 }; listOfUnion2	109 = { id: 109, field109: 15 }; listOfUnion2
sumOfUnion2(): number { let sum = 0; for (let i = 0; i < listOfUnion2.length; i++) { const held: Union2 | undefined = listOfUnion2[i]; if (held) sum += held.id; else sum -= 1; } return sum	7 = { id: 7, field7: 0 }; listOfUnion3	8 = { id: 8, field8: 1 }; listOfUnion3	12 = { id: 12, field12: 2 }; listOfUnion3.push(made); } listOfUnion3	13 = { id: 13, field13: 3 }; listOfUnion3	24 = { id: 24, field24: 4 }; listOfUnion3	26 = { id: 26, field26: 5 }; listOfUnion3	47 = { id: 47, field47: 6 }; listOfUnion3	63 = { id: 63, field63: 7 }; listOfUnion3.push(made); } listOfUnion3	70 = { id: 70, field70: 8 }; listOfUnion3	72 = { id: 72, field72: 9 }; listOfUnion3	73 = { id: 73, field73: 10 }; listOfUnion3	74 = { id: 74, field74: 11 }; listOfUnion3	79 = { id: 79, field79: 12 }; listOfUnion3.push(made); } listOfUnion3	81 = { id: 81, field81: 13 }; listOfUnion3	87 = { id: 87, field87: 14 }; listOfUnion3	91 = { id: 91, field91: 15 }; listOfUnion3
sumOfUnion3(): number { let sum = 0; for (let i = 0; i < listOfUnion3.length; i++) { const held: Union3 | undefined = listOfUnion3[i]; if (held) sum += held.id; else sum -= 1; } return sum	10 = { id: 10, field10: 0 }; listOfUnion4	23 = { id: 23, field23: 1 }; listOfUnion4	31 = { id: 31, field31: 2 }; listOfUnion4.push(made); } listOfUnion4	38 = { id: 38, field38: 3 }; listOfUnion4	40 = { id: 40, field40: 4 }; listOfUnion4	46 = { id: 46, field46: 5 }; listOfUnion4	54 = { id: 54, field54: 6 }; listOfUnion4	58 = { id: 58, field58: 7 }; listOfUnion4.push(made); } listOfUnion4	59 = { id: 59, field59: 8 }; listOfUnion4	68 = { id: 68, field68: 9 }; listOfUnion4	73 = { id: 73, field73: 10 }; listOfUnion4	74 = { id: 74, field74: 11 }; listOfUnion4	89 = { id: 89, field89: 12 }; listOfUnion4.push(made); } listOfUnion4	99 = { id: 99, field99: 13 }; listOfUnion4	101 = { id: 101, field101: 14 }; listOfUnion4	118 = { id: 118, field118: 15 }; listOfUnion4
sumOfUnion4(): number { let sum = 0; for (let i = 0; i < listOfUnion4.length; i++) { const held: Union4 | undefined = listOfUnion4[i]; if (held) sum += held.id; else sum -= 1; } return sum	9 = { id: 9, field9: 0 }; listOfUnion5	15 = { id: 15, field15: 1 }; listOfUnion5	19 = { id: 19, field19: 2 }; listOfUnion5.push(made); } listOfUnion5	21 = { id: 21, field21: 3 }; listOfUnion5	36 = { id: 36, field36: 4 }; listOfUnion5	38 = { id: 38, field38: 5 }; listOfUnion5	43 = { id: 43, field43: 6 }; listOfUnion5	53 = { id: 53, field53: 7 }; listOfUnion5.push(made); } listOfUnion5	57 = { id: 57, field57: 8 }; listOfUnion5	63 = { id: 63, field63: 9 }; listOfUnion5	65 = { id: 65, field65: 10 }; listOfUnion5	67 = { id: 67, field67: 11 }; listOfUnion5	77 = { id: 77, field77: 12 }; listOfUnion5.push(made); } listOfUnion5	93 = { id: 93, field93: 13 }; listOfUnion5	96 = { id: 96, field96: 14 }; listOfUnion5	112 = { id: 112, field112: 15 }; listOfUnion5
sumOfUnion5(): number { let sum = 0; for (let i = 0; i < listOfUnion5.length; i++) { const held: Union5 | undefined = listOfUnion5[i]; if (held) sum += held.id; else sum -= 1; } return sum	5 = { id: 5, field5: 0 }; listOfUnion6	9 = { id: 9, field9: 1 }; listOfUnion6	40 = { id: 40, field40: 2 }; listOfUnion6.push(made); } listOfUnion6	43 = { id: 43, field43: 3 }; listOfUnion6	44 = { id: 44, field44: 4 }; listOfUnion6	53 = { id: 53, field53: 5 }; listOfUnion6	62 = { id: 62, field62: 6 }; listOfUnion6	71 = { id: 71, field71: 7 }; listOfUnion6.push(made); } listOfUnion6	73 = { id: 73, field73: 8 }; listOfUnion6	85 = { id: 85, field85: 9 }; listOfUnion6	88 = { id: 88, field88: 10 }; listOfUnion6	97 = { id: 97, field97: 11 }; listOfUnion6	101 = { id: 101, field101: 12 }; listOfUnion6.push(made); } listOfUnion6	104 = { id: 104, field104: 13 }; listOfUnion6	112 = { id: 112, field112: 14 }; listOfUnion6	119 = { id: 119, field119: 15 }; listOfUnion6
sumOfUnion6(): number { let sum = 0; for (let i = 0; i < listOfUnion6.length; i++) { const held: Union6 | undefined = listOfUnion6[i]; if (held) sum += held.id; else sum -= 1; } return sum	7 = { id: 7, field7: 0 }; listOfUnion7	8 = { id: 8, field8: 1 }; listOfUnion7	11 = { id: 11, field11: 2 }; listOfUnion7.push(made); } listOfUnion7	34 = { id: 34, field34: 3 }; listOfUnion7	39 = { id: 39, field39: 4 }; listOfUnion7	58 = { id: 58, field58: 5 }; listOfUnion7	60 = { id: 60, field60: 6 }; listOfUnion7	63 = { id: 63, field63: 7 }; listOfUnion7.push(made); } listOfUnion7	74 = { id: 74, field74: 8 }; listOfUnion7	76 = { id: 76, field76: 9 }; listOfUnion7	82 = { id: 82, field82: 10 }; listOfUnion7	85 = { id: 85, field85: 11 }; listOfUnion7	89 = { id: 89, field89: 12 }; listOfUnion7.push(made); } listOfUnion7	93 = { id: 93, field93: 13 }; listOfUnion7	102 = { id: 102, field102: 14 }; listOfUnion7	107 = { id: 107, field107: 15 }; listOfUnion7
sumOfUnion7(): number { let sum = 0; for (let i = 0; i < listOfUnion7.length; i++) { const held: Union7 | undefined = listOfUnion7[i]; if (held) sum += held.id; else sum -= 1; } return sum	2 = { id: 2, field2: 0 }; listOfUnion8	14 = { id: 14, field14: 1 }; listOfUnion8	21 = { id: 21, field21: 2 }; listOfUnion8.push(made); } listOfUnion8	36 = { id: 36, field36: 3 }; listOfUnion8	44 = { id: 44, field44: 4 }; listOfUnion8	45 = { id: 45, field45: 5 }; listOfUnion8	49 = { id: 49, field49: 6 }; listOfUnion8	57 = { id: 57, field57: 7 }; listOfUnion8.push(made); } listOfUnion8	59 = { id: 59, field59: 8 }; listOfUnion8	73 = { id: 73, field73: 9 }; listOfUnion8	78 = { id: 78, field78: 10 }; listOfUnion8	85 = { id: 85, field85: 11 }; listOfUnion8	87 = { id: 87, field87: 12 }; listOfUnion8.push(made); } listOfUnion8	91 = { id: 91, field91: 13 }; listOfUnion8	105 = { id: 105, field105: 14 }; listOfUnion8	113 = { id: 113, field113: 15 }; listOfUnion8
sumOfUnion8(): number { let sum = 0; for (let i = 0; i < listOfUnion8.length; i++) { const held: Union8 | undefined = listOfUnion8[i]; if (held) sum += held.id; else sum -= 1; } return sum	7 = { id: 7, field7: 0 }; listOfUnion9	10 = { id: 10, field10: 1 }; listOfUnion9	16 = { id: 16, field16: 2 }; listOfUnion9.push(made); } listOfUnion9	21 = { id: 21, field21: 3 }; listOfUnion9	27 = { id: 27, field27: 4 }; listOfUnion9	31 = { id: 31, field31: 5 }; listOfUnion9	36 = { id: 36, field36: 6 }; listOfUnion9	50 = { id: 50, field50: 7 }; listOfUnion9.push(made); } listOfUnion9	51 = { id: 51, field51: 8 }; listOfUnion9	57 = { id: 57, field57: 9 }; listOfUnion9	63 = { id: 63, field63: 10 }; listOfUnion9	70 = { id: 70, field70: 11 }; listOfUnion9	94 = { id: 94, field94: 12 }; listOfUnion9.push(made); } listOfUnion9	98 = { id: 98, field98: 13 }; listOfUnion9	111 = { id: 111, field111: 14 }; listOfUnion9	117 = { id: 117, field117: 15 }; listOfUnion9
sumOfUnion9(): number { let sum = 0; for (let i = 0; i < listOfUnion9.length; i++) { const held: Union9 | undefined = listOfUnion9[i]; if (held) sum += held.id; else sum -= 1; } return sum	10 = { id: 10, field10: 0 }; listOfUnion10	17 = { id: 17, field17: 1 }; listOfUnion10	19 = { id: 19, field19: 2 }; listOfUnion10.push(made); } listOfUnion10	22 = { id: 22, field22: 3 }; listOfUnion10	29 = { id: 29, field29: 4 }; listOfUnion10	35 = { id: 35, field35: 5 }; listOfUnion10	45 = { id: 45, field45: 6 }; listOfUnion10	48 = { id: 48, field48: 7 }; listOfUnion10.push(made); } listOfUnion10	53 = { id: 53, field53: 8 }; listOfUnion10	55 = { id: 55, field55: 9 }; listOfUnion10	70 = { id: 70, field70: 10 }; listOfUnion10	87 = { id: 87, field87: 11 }; listOfUnion10	90 = { id: 90, field90: 12 }; listOfUnion10.push(made); } listOfUnion10	104 = { id: 104, field104: 13 }; listOfUnion10	110 = { id: 110, field110: 14 }; listOfUnion10	113 = { id: 113, field113: 15 }; listOfUnion10
sumOfUnion10(): number { let sum = 0; for (let i = 0; i < listOfUnion10.length; i++) { const held: Union10 | undefined = listOfUnion10[i]; if (held) sum += held.id; else sum -= 1; } return sum	0 = { id: 0, field0: 0 }; listOfUnion11	1 = { id: 1, field1: 1 }; listOfUnion11	18 = { id: 18, field18: 2 }; listOfUnion11.push(made); } listOfUnion11	19 = { id: 19, field19: 3 }; listOfUnion11	23 = { id: 23, field23: 4 }; listOfUnion11	29 = { id: 29, field29: 5 }; listOfUnion11	33 = { id: 33, field33: 6 }; listOfUnion11	36 = { id: 36, field36: 7 }; listOfUnion11.push(made); } listOfUnion11	47 = { id: 47, field47: 8 }; listOfUnion11	53 = { id: 53, field53: 9 }; listOfUnion11	62 = { id: 62, field62: 10 }; listOfUnion11	68 = { id: 68, field68: 11 }; listOfUnion11	75 = { id: 75, field75: 12 }; listOfUnion11.push(made); } listOfUnion11	78 = { id: 78, field78: 13 }; listOfUnion11	84 = { id: 84, field84: 14 }; listOfUnion11	106 = { id: 106, field106: 15 }; listOfUnion11
sumOfUnion11(): number { let sum = 0; for (let i = 0; i < listOfUnion11.length; i++) { const held: Union11 | undefined = listOfUnion11[i]; if (held) sum += held.id; else sum -= 1; } return sum	6 = { id: 6, field6: 0 }; listOfUnion12	16 = { id: 16, field16: 1 }; listOfUnion12	40 = { id: 40, field40: 2 }; listOfUnion12.push(made); } listOfUnion12	58 = { id: 58, field58: 3 }; listOfUnion12	65 = { id: 65, field65: 4 }; listOfUnion12	72 = { id: 72, field72: 5 }; listOfUnion12	79 = { id: 79, field79: 6 }; listOfUnion12	83 = { id: 83, field83: 7 }; listOfUnion12.push(made); } listOfUnion12	86 = { id: 86, field86: 8 }; listOfUnion12	87 = { id: 87, field87: 9 }; listOfUnion12	88 = { id: 88, field88: 10 }; listOfUnion12	94 = { id: 94, field94: 11 }; listOfUnion12	99 = { id: 99, field99: 12 }; listOfUnion12.push(made); } listOfUnion12	109 = { id: 109, field109: 13 }; listOfUnion12	111 = { id: 111, field111: 14 }; listOfUnion12	115 = { id: 115, field115: 15 }; listOfUnion12
sumOfUnion12(): number { let sum = 0; for (let i = 0; i < listOfUnion12.length; i++) { const held: Union12 | undefined = listOfUnion12[i]; if (held) sum += held.id; else sum -= 1; } return sum	7 = { id: 7, field7: 0 }; listOfUnion13	8 = { id: 8, field8: 1 }; listOfUnion13	13 = { id: 13, field13: 2 }; listOfUnion13.push(made); } listOfUnion13	14 = { id: 14, field14: 3 }; listOfUnion13	20 = { id: 20, field20: 4 }; listOfUnion13	24 = { id: 24, field24: 5 }; listOfUnion13	26 = { id: 26, field26: 6 }; listOfUnion13	43 = { id: 43, field43: 7 }; listOfUnion13.push(made); } listOfUnion13	50 = { id: 50, field50: 8 }; listOfUnion13	51 = { id: 51, field51: 9 }; listOfUnion13	56 = { id: 56, field56: 10 }; listOfUnion13	61 = { id: 61, field61: 11 }; listOfUnion13	71 = { id: 71, field71: 12 }; listOfUnion13.push(made); } listOfUnion13	76 = { id: 76, field76: 13 }; listOfUnion13	81 = { id: 81, field81: 14 }; listOfUnion13	102 = { id: 102, field102: 15 }; listOfUnion13`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o, p, q, r) => `function ${a}; }
const listOfUnion${n}: (Union${n} | undefined)[] = [];
function fillUnion${n}(): void {
    { const made: Kind${b}.push(made); }
    { const made: Kind${c}.push(made); }
    { const made: Kind${d}.push(undefined);
    { const made: Kind${e}.push(made); }
    { const made: Kind${f}.push(made); }
    { const made: Kind${g}.push(made); }
    { const made: Kind${h}.push(made); }
    { const made: Kind${i}.push(undefined);
    { const made: Kind${j}.push(made); }
    { const made: Kind${k}.push(made); }
    { const made: Kind${l}.push(made); }
    { const made: Kind${m}.push(made); }
    { const made: Kind${o}.push(undefined);
    { const made: Kind${p}.push(made); }
    { const made: Kind${q}.push(made); }
    { const made: Kind${r}.push(made); }
}
fillUnion${n}();`,
      ],
      `function sumOfUnion13(): number { let sum = 0; for (let i = 0; i < listOfUnion13.length; i++) { const held: Union13 | undefined = listOfUnion13[i]; if (held) sum += held.id; else sum -= 1; } return sum; }
function held(list: Root[], from: (Root | undefined)[]): void { const count = from.length; for (let i = 0; i < count; i++) { const root = from[i]; if (root) list.push(root); } }
function count(sum: () => number): string { try { return "sum " + sum(); } catch (error) { return "refused: " + (error instanceof TypeError); } }
held(listOfUnion0 as Root[], listOfUnion1);
held(listOfUnion5 as Root[], listOfUnion9);
held(listOfUnion13 as Root[], listOfUnion2);
held(listOfUnion7 as Root[], listOfUnion11);
console.log("Union0", listOfUnion0.length, count(sumOfUnion0));
console.log("Union1", listOfUnion1.length, count(sumOfUnion1));
console.log("Union2", listOfUnion2.length, count(sumOfUnion2));
console.log("Union3", listOfUnion3.length, count(sumOfUnion3));
console.log("Union4", listOfUnion4.length, count(sumOfUnion4));
console.log("Union5", listOfUnion5.length, count(sumOfUnion5));
console.log("Union6", listOfUnion6.length, count(sumOfUnion6));
console.log("Union7", listOfUnion7.length, count(sumOfUnion7));
console.log("Union8", listOfUnion8.length, count(sumOfUnion8));
console.log("Union9", listOfUnion9.length, count(sumOfUnion9));
console.log("Union10", listOfUnion10.length, count(sumOfUnion10));
console.log("Union11", listOfUnion11.length, count(sumOfUnion11));
console.log("Union12", listOfUnion12.length, count(sumOfUnion12));
console.log("Union13", listOfUnion13.length, count(sumOfUnion13));
`,
    ),
    "values-into-large-unions.ts": text(
      `// Values enter unions of many types. A hundred and twenty record types, and fourteen unions that each take sixteen of them, crossing one another so that no numbering of the types
// makes every union a row. Elements of arrays are anything until they are read: each read is tested. What belongs passes, however large the union is.`,
      [
        `Root { id
Kind10 extends Root { field10
Kind21 extends Root { field21
Kind32 extends Root { field32
Kind43 extends Root { field43
Kind54 extends Root { field54
Kind65 extends Root { field65
Kind76 extends Root { field76
Kind87 extends Root { field87
Kind98 extends Root { field98
Kind109 extends Root { field109`,
        (n, a) => `interface ${a}: number }
interface Kind${11 * n} extends Root { field${11 * n}: number }
interface Kind${11 * n + 1} extends Root { field${11 * n + 1}: number }
interface Kind${11 * n + 2} extends Root { field${11 * n + 2}: number }
interface Kind${11 * n + 3} extends Root { field${11 * n + 3}: number }
interface Kind${11 * n + 4} extends Root { field${11 * n + 4}: number }
interface Kind${11 * n + 5} extends Root { field${11 * n + 5}: number }
interface Kind${11 * n + 6} extends Root { field${11 * n + 6}: number }
interface Kind${11 * n + 7} extends Root { field${11 * n + 7}: number }
interface Kind${11 * n + 8} extends Root { field${11 * n + 8}: number }
interface Kind${11 * n + 9} extends Root { field${11 * n + 9}: number }`,
      ],
      `type Union0 = Kind4 | Kind6 | Kind7 | Kind9 | Kind12 | Kind19 | Kind27 | Kind41 | Kind46 | Kind50 | Kind64 | Kind68 | Kind74 | Kind83 | Kind105 | Kind116;
type Union1 = Kind7 | Kind8 | Kind11 | Kind15 | Kind28 | Kind30 | Kind50 | Kind53 | Kind54 | Kind55 | Kind70 | Kind72 | Kind73 | Kind74 | Kind80 | Kind105;
type Union2 = Kind5 | Kind6 | Kind15 | Kind17 | Kind18 | Kind23 | Kind28 | Kind37 | Kind39 | Kind53 | Kind69 | Kind71 | Kind73 | Kind87 | Kind104 | Kind109;
type Union3 = Kind7 | Kind8 | Kind12 | Kind13 | Kind24 | Kind26 | Kind47 | Kind63 | Kind70 | Kind72 | Kind73 | Kind74 | Kind79 | Kind81 | Kind87 | Kind91;
type Union4 = Kind10 | Kind23 | Kind31 | Kind38 | Kind40 | Kind46 | Kind54 | Kind58 | Kind59 | Kind68 | Kind73 | Kind74 | Kind89 | Kind99 | Kind101 | Kind118;
type Union5 = Kind9 | Kind15 | Kind19 | Kind21 | Kind36 | Kind38 | Kind43 | Kind53 | Kind57 | Kind63 | Kind65 | Kind67 | Kind77 | Kind93 | Kind96 | Kind112;
type Union6 = Kind5 | Kind9 | Kind40 | Kind43 | Kind44 | Kind53 | Kind62 | Kind71 | Kind73 | Kind85 | Kind88 | Kind97 | Kind101 | Kind104 | Kind112 | Kind119;
type Union7 = Kind7 | Kind8 | Kind11 | Kind34 | Kind39 | Kind58 | Kind60 | Kind63 | Kind74 | Kind76 | Kind82 | Kind85 | Kind89 | Kind93 | Kind102 | Kind107;
type Union8 = Kind2 | Kind14 | Kind21 | Kind36 | Kind44 | Kind45 | Kind49 | Kind57 | Kind59 | Kind73 | Kind78 | Kind85 | Kind87 | Kind91 | Kind105 | Kind113;
type Union9 = Kind7 | Kind10 | Kind16 | Kind21 | Kind27 | Kind31 | Kind36 | Kind50 | Kind51 | Kind57 | Kind63 | Kind70 | Kind94 | Kind98 | Kind111 | Kind117;
type Union10 = Kind10 | Kind17 | Kind19 | Kind22 | Kind29 | Kind35 | Kind45 | Kind48 | Kind53 | Kind55 | Kind70 | Kind87 | Kind90 | Kind104 | Kind110 | Kind113;
type Union11 = Kind0 | Kind1 | Kind18 | Kind19 | Kind23 | Kind29 | Kind33 | Kind36 | Kind47 | Kind53 | Kind62 | Kind68 | Kind75 | Kind78 | Kind84 | Kind106;
type Union12 = Kind6 | Kind16 | Kind40 | Kind58 | Kind65 | Kind72 | Kind79 | Kind83 | Kind86 | Kind87 | Kind88 | Kind94 | Kind99 | Kind109 | Kind111 | Kind115;
type Union13 = Kind7 | Kind8 | Kind13 | Kind14 | Kind20 | Kind24 | Kind26 | Kind43 | Kind50 | Kind51 | Kind56 | Kind61 | Kind71 | Kind76 | Kind81 | Kind102;`,
      [
        `describe(root: Root | undefined): string { return root ? Object.keys(root).join() + ":" + Object.values(root).join() : "nothing"	4 = { id: 4, field4: 0 }; listOfUnion0	6 = { id: 6, field6: 1 }; listOfUnion0	7 = { id: 7, field7: 2 }; listOfUnion0.push(made); } listOfUnion0	9 = { id: 9, field9: 3 }; listOfUnion0	12 = { id: 12, field12: 4 }; listOfUnion0	19 = { id: 19, field19: 5 }; listOfUnion0	27 = { id: 27, field27: 6 }; listOfUnion0	41 = { id: 41, field41: 7 }; listOfUnion0.push(made); } listOfUnion0	46 = { id: 46, field46: 8 }; listOfUnion0	50 = { id: 50, field50: 9 }; listOfUnion0	64 = { id: 64, field64: 10 }; listOfUnion0	68 = { id: 68, field68: 11 }; listOfUnion0	74 = { id: 74, field74: 12 }; listOfUnion0.push(made); } listOfUnion0	83 = { id: 83, field83: 13 }; listOfUnion0	105 = { id: 105, field105: 14 }; listOfUnion0	116 = { id: 116, field116: 15 }; listOfUnion0
sumOfUnion0(): number { let sum = 0; for (let i = 0; i < listOfUnion0.length; i++) { const held: Union0 | undefined = listOfUnion0[i]; if (held) sum += held.id; else sum -= 1; } return sum	7 = { id: 7, field7: 0 }; listOfUnion1	8 = { id: 8, field8: 1 }; listOfUnion1	11 = { id: 11, field11: 2 }; listOfUnion1.push(made); } listOfUnion1	15 = { id: 15, field15: 3 }; listOfUnion1	28 = { id: 28, field28: 4 }; listOfUnion1	30 = { id: 30, field30: 5 }; listOfUnion1	50 = { id: 50, field50: 6 }; listOfUnion1	53 = { id: 53, field53: 7 }; listOfUnion1.push(made); } listOfUnion1	54 = { id: 54, field54: 8 }; listOfUnion1	55 = { id: 55, field55: 9 }; listOfUnion1	70 = { id: 70, field70: 10 }; listOfUnion1	72 = { id: 72, field72: 11 }; listOfUnion1	73 = { id: 73, field73: 12 }; listOfUnion1.push(made); } listOfUnion1	74 = { id: 74, field74: 13 }; listOfUnion1	80 = { id: 80, field80: 14 }; listOfUnion1	105 = { id: 105, field105: 15 }; listOfUnion1
sumOfUnion1(): number { let sum = 0; for (let i = 0; i < listOfUnion1.length; i++) { const held: Union1 | undefined = listOfUnion1[i]; if (held) sum += held.id; else sum -= 1; } return sum	5 = { id: 5, field5: 0 }; listOfUnion2	6 = { id: 6, field6: 1 }; listOfUnion2	15 = { id: 15, field15: 2 }; listOfUnion2.push(made); } listOfUnion2	17 = { id: 17, field17: 3 }; listOfUnion2	18 = { id: 18, field18: 4 }; listOfUnion2	23 = { id: 23, field23: 5 }; listOfUnion2	28 = { id: 28, field28: 6 }; listOfUnion2	37 = { id: 37, field37: 7 }; listOfUnion2.push(made); } listOfUnion2	39 = { id: 39, field39: 8 }; listOfUnion2	53 = { id: 53, field53: 9 }; listOfUnion2	69 = { id: 69, field69: 10 }; listOfUnion2	71 = { id: 71, field71: 11 }; listOfUnion2	73 = { id: 73, field73: 12 }; listOfUnion2.push(made); } listOfUnion2	87 = { id: 87, field87: 13 }; listOfUnion2	104 = { id: 104, field104: 14 }; listOfUnion2	109 = { id: 109, field109: 15 }; listOfUnion2
sumOfUnion2(): number { let sum = 0; for (let i = 0; i < listOfUnion2.length; i++) { const held: Union2 | undefined = listOfUnion2[i]; if (held) sum += held.id; else sum -= 1; } return sum	7 = { id: 7, field7: 0 }; listOfUnion3	8 = { id: 8, field8: 1 }; listOfUnion3	12 = { id: 12, field12: 2 }; listOfUnion3.push(made); } listOfUnion3	13 = { id: 13, field13: 3 }; listOfUnion3	24 = { id: 24, field24: 4 }; listOfUnion3	26 = { id: 26, field26: 5 }; listOfUnion3	47 = { id: 47, field47: 6 }; listOfUnion3	63 = { id: 63, field63: 7 }; listOfUnion3.push(made); } listOfUnion3	70 = { id: 70, field70: 8 }; listOfUnion3	72 = { id: 72, field72: 9 }; listOfUnion3	73 = { id: 73, field73: 10 }; listOfUnion3	74 = { id: 74, field74: 11 }; listOfUnion3	79 = { id: 79, field79: 12 }; listOfUnion3.push(made); } listOfUnion3	81 = { id: 81, field81: 13 }; listOfUnion3	87 = { id: 87, field87: 14 }; listOfUnion3	91 = { id: 91, field91: 15 }; listOfUnion3
sumOfUnion3(): number { let sum = 0; for (let i = 0; i < listOfUnion3.length; i++) { const held: Union3 | undefined = listOfUnion3[i]; if (held) sum += held.id; else sum -= 1; } return sum	10 = { id: 10, field10: 0 }; listOfUnion4	23 = { id: 23, field23: 1 }; listOfUnion4	31 = { id: 31, field31: 2 }; listOfUnion4.push(made); } listOfUnion4	38 = { id: 38, field38: 3 }; listOfUnion4	40 = { id: 40, field40: 4 }; listOfUnion4	46 = { id: 46, field46: 5 }; listOfUnion4	54 = { id: 54, field54: 6 }; listOfUnion4	58 = { id: 58, field58: 7 }; listOfUnion4.push(made); } listOfUnion4	59 = { id: 59, field59: 8 }; listOfUnion4	68 = { id: 68, field68: 9 }; listOfUnion4	73 = { id: 73, field73: 10 }; listOfUnion4	74 = { id: 74, field74: 11 }; listOfUnion4	89 = { id: 89, field89: 12 }; listOfUnion4.push(made); } listOfUnion4	99 = { id: 99, field99: 13 }; listOfUnion4	101 = { id: 101, field101: 14 }; listOfUnion4	118 = { id: 118, field118: 15 }; listOfUnion4
sumOfUnion4(): number { let sum = 0; for (let i = 0; i < listOfUnion4.length; i++) { const held: Union4 | undefined = listOfUnion4[i]; if (held) sum += held.id; else sum -= 1; } return sum	9 = { id: 9, field9: 0 }; listOfUnion5	15 = { id: 15, field15: 1 }; listOfUnion5	19 = { id: 19, field19: 2 }; listOfUnion5.push(made); } listOfUnion5	21 = { id: 21, field21: 3 }; listOfUnion5	36 = { id: 36, field36: 4 }; listOfUnion5	38 = { id: 38, field38: 5 }; listOfUnion5	43 = { id: 43, field43: 6 }; listOfUnion5	53 = { id: 53, field53: 7 }; listOfUnion5.push(made); } listOfUnion5	57 = { id: 57, field57: 8 }; listOfUnion5	63 = { id: 63, field63: 9 }; listOfUnion5	65 = { id: 65, field65: 10 }; listOfUnion5	67 = { id: 67, field67: 11 }; listOfUnion5	77 = { id: 77, field77: 12 }; listOfUnion5.push(made); } listOfUnion5	93 = { id: 93, field93: 13 }; listOfUnion5	96 = { id: 96, field96: 14 }; listOfUnion5	112 = { id: 112, field112: 15 }; listOfUnion5
sumOfUnion5(): number { let sum = 0; for (let i = 0; i < listOfUnion5.length; i++) { const held: Union5 | undefined = listOfUnion5[i]; if (held) sum += held.id; else sum -= 1; } return sum	5 = { id: 5, field5: 0 }; listOfUnion6	9 = { id: 9, field9: 1 }; listOfUnion6	40 = { id: 40, field40: 2 }; listOfUnion6.push(made); } listOfUnion6	43 = { id: 43, field43: 3 }; listOfUnion6	44 = { id: 44, field44: 4 }; listOfUnion6	53 = { id: 53, field53: 5 }; listOfUnion6	62 = { id: 62, field62: 6 }; listOfUnion6	71 = { id: 71, field71: 7 }; listOfUnion6.push(made); } listOfUnion6	73 = { id: 73, field73: 8 }; listOfUnion6	85 = { id: 85, field85: 9 }; listOfUnion6	88 = { id: 88, field88: 10 }; listOfUnion6	97 = { id: 97, field97: 11 }; listOfUnion6	101 = { id: 101, field101: 12 }; listOfUnion6.push(made); } listOfUnion6	104 = { id: 104, field104: 13 }; listOfUnion6	112 = { id: 112, field112: 14 }; listOfUnion6	119 = { id: 119, field119: 15 }; listOfUnion6
sumOfUnion6(): number { let sum = 0; for (let i = 0; i < listOfUnion6.length; i++) { const held: Union6 | undefined = listOfUnion6[i]; if (held) sum += held.id; else sum -= 1; } return sum	7 = { id: 7, field7: 0 }; listOfUnion7	8 = { id: 8, field8: 1 }; listOfUnion7	11 = { id: 11, field11: 2 }; listOfUnion7.push(made); } listOfUnion7	34 = { id: 34, field34: 3 }; listOfUnion7	39 = { id: 39, field39: 4 }; listOfUnion7	58 = { id: 58, field58: 5 }; listOfUnion7	60 = { id: 60, field60: 6 }; listOfUnion7	63 = { id: 63, field63: 7 }; listOfUnion7.push(made); } listOfUnion7	74 = { id: 74, field74: 8 }; listOfUnion7	76 = { id: 76, field76: 9 }; listOfUnion7	82 = { id: 82, field82: 10 }; listOfUnion7	85 = { id: 85, field85: 11 }; listOfUnion7	89 = { id: 89, field89: 12 }; listOfUnion7.push(made); } listOfUnion7	93 = { id: 93, field93: 13 }; listOfUnion7	102 = { id: 102, field102: 14 }; listOfUnion7	107 = { id: 107, field107: 15 }; listOfUnion7
sumOfUnion7(): number { let sum = 0; for (let i = 0; i < listOfUnion7.length; i++) { const held: Union7 | undefined = listOfUnion7[i]; if (held) sum += held.id; else sum -= 1; } return sum	2 = { id: 2, field2: 0 }; listOfUnion8	14 = { id: 14, field14: 1 }; listOfUnion8	21 = { id: 21, field21: 2 }; listOfUnion8.push(made); } listOfUnion8	36 = { id: 36, field36: 3 }; listOfUnion8	44 = { id: 44, field44: 4 }; listOfUnion8	45 = { id: 45, field45: 5 }; listOfUnion8	49 = { id: 49, field49: 6 }; listOfUnion8	57 = { id: 57, field57: 7 }; listOfUnion8.push(made); } listOfUnion8	59 = { id: 59, field59: 8 }; listOfUnion8	73 = { id: 73, field73: 9 }; listOfUnion8	78 = { id: 78, field78: 10 }; listOfUnion8	85 = { id: 85, field85: 11 }; listOfUnion8	87 = { id: 87, field87: 12 }; listOfUnion8.push(made); } listOfUnion8	91 = { id: 91, field91: 13 }; listOfUnion8	105 = { id: 105, field105: 14 }; listOfUnion8	113 = { id: 113, field113: 15 }; listOfUnion8
sumOfUnion8(): number { let sum = 0; for (let i = 0; i < listOfUnion8.length; i++) { const held: Union8 | undefined = listOfUnion8[i]; if (held) sum += held.id; else sum -= 1; } return sum	7 = { id: 7, field7: 0 }; listOfUnion9	10 = { id: 10, field10: 1 }; listOfUnion9	16 = { id: 16, field16: 2 }; listOfUnion9.push(made); } listOfUnion9	21 = { id: 21, field21: 3 }; listOfUnion9	27 = { id: 27, field27: 4 }; listOfUnion9	31 = { id: 31, field31: 5 }; listOfUnion9	36 = { id: 36, field36: 6 }; listOfUnion9	50 = { id: 50, field50: 7 }; listOfUnion9.push(made); } listOfUnion9	51 = { id: 51, field51: 8 }; listOfUnion9	57 = { id: 57, field57: 9 }; listOfUnion9	63 = { id: 63, field63: 10 }; listOfUnion9	70 = { id: 70, field70: 11 }; listOfUnion9	94 = { id: 94, field94: 12 }; listOfUnion9.push(made); } listOfUnion9	98 = { id: 98, field98: 13 }; listOfUnion9	111 = { id: 111, field111: 14 }; listOfUnion9	117 = { id: 117, field117: 15 }; listOfUnion9
sumOfUnion9(): number { let sum = 0; for (let i = 0; i < listOfUnion9.length; i++) { const held: Union9 | undefined = listOfUnion9[i]; if (held) sum += held.id; else sum -= 1; } return sum	10 = { id: 10, field10: 0 }; listOfUnion10	17 = { id: 17, field17: 1 }; listOfUnion10	19 = { id: 19, field19: 2 }; listOfUnion10.push(made); } listOfUnion10	22 = { id: 22, field22: 3 }; listOfUnion10	29 = { id: 29, field29: 4 }; listOfUnion10	35 = { id: 35, field35: 5 }; listOfUnion10	45 = { id: 45, field45: 6 }; listOfUnion10	48 = { id: 48, field48: 7 }; listOfUnion10.push(made); } listOfUnion10	53 = { id: 53, field53: 8 }; listOfUnion10	55 = { id: 55, field55: 9 }; listOfUnion10	70 = { id: 70, field70: 10 }; listOfUnion10	87 = { id: 87, field87: 11 }; listOfUnion10	90 = { id: 90, field90: 12 }; listOfUnion10.push(made); } listOfUnion10	104 = { id: 104, field104: 13 }; listOfUnion10	110 = { id: 110, field110: 14 }; listOfUnion10	113 = { id: 113, field113: 15 }; listOfUnion10
sumOfUnion10(): number { let sum = 0; for (let i = 0; i < listOfUnion10.length; i++) { const held: Union10 | undefined = listOfUnion10[i]; if (held) sum += held.id; else sum -= 1; } return sum	0 = { id: 0, field0: 0 }; listOfUnion11	1 = { id: 1, field1: 1 }; listOfUnion11	18 = { id: 18, field18: 2 }; listOfUnion11.push(made); } listOfUnion11	19 = { id: 19, field19: 3 }; listOfUnion11	23 = { id: 23, field23: 4 }; listOfUnion11	29 = { id: 29, field29: 5 }; listOfUnion11	33 = { id: 33, field33: 6 }; listOfUnion11	36 = { id: 36, field36: 7 }; listOfUnion11.push(made); } listOfUnion11	47 = { id: 47, field47: 8 }; listOfUnion11	53 = { id: 53, field53: 9 }; listOfUnion11	62 = { id: 62, field62: 10 }; listOfUnion11	68 = { id: 68, field68: 11 }; listOfUnion11	75 = { id: 75, field75: 12 }; listOfUnion11.push(made); } listOfUnion11	78 = { id: 78, field78: 13 }; listOfUnion11	84 = { id: 84, field84: 14 }; listOfUnion11	106 = { id: 106, field106: 15 }; listOfUnion11
sumOfUnion11(): number { let sum = 0; for (let i = 0; i < listOfUnion11.length; i++) { const held: Union11 | undefined = listOfUnion11[i]; if (held) sum += held.id; else sum -= 1; } return sum	6 = { id: 6, field6: 0 }; listOfUnion12	16 = { id: 16, field16: 1 }; listOfUnion12	40 = { id: 40, field40: 2 }; listOfUnion12.push(made); } listOfUnion12	58 = { id: 58, field58: 3 }; listOfUnion12	65 = { id: 65, field65: 4 }; listOfUnion12	72 = { id: 72, field72: 5 }; listOfUnion12	79 = { id: 79, field79: 6 }; listOfUnion12	83 = { id: 83, field83: 7 }; listOfUnion12.push(made); } listOfUnion12	86 = { id: 86, field86: 8 }; listOfUnion12	87 = { id: 87, field87: 9 }; listOfUnion12	88 = { id: 88, field88: 10 }; listOfUnion12	94 = { id: 94, field94: 11 }; listOfUnion12	99 = { id: 99, field99: 12 }; listOfUnion12.push(made); } listOfUnion12	109 = { id: 109, field109: 13 }; listOfUnion12	111 = { id: 111, field111: 14 }; listOfUnion12	115 = { id: 115, field115: 15 }; listOfUnion12
sumOfUnion12(): number { let sum = 0; for (let i = 0; i < listOfUnion12.length; i++) { const held: Union12 | undefined = listOfUnion12[i]; if (held) sum += held.id; else sum -= 1; } return sum	7 = { id: 7, field7: 0 }; listOfUnion13	8 = { id: 8, field8: 1 }; listOfUnion13	13 = { id: 13, field13: 2 }; listOfUnion13.push(made); } listOfUnion13	14 = { id: 14, field14: 3 }; listOfUnion13	20 = { id: 20, field20: 4 }; listOfUnion13	24 = { id: 24, field24: 5 }; listOfUnion13	26 = { id: 26, field26: 6 }; listOfUnion13	43 = { id: 43, field43: 7 }; listOfUnion13.push(made); } listOfUnion13	50 = { id: 50, field50: 8 }; listOfUnion13	51 = { id: 51, field51: 9 }; listOfUnion13	56 = { id: 56, field56: 10 }; listOfUnion13	61 = { id: 61, field61: 11 }; listOfUnion13	71 = { id: 71, field71: 12 }; listOfUnion13.push(made); } listOfUnion13	76 = { id: 76, field76: 13 }; listOfUnion13	81 = { id: 81, field81: 14 }; listOfUnion13	102 = { id: 102, field102: 15 }; listOfUnion13`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o, p, q, r) => `function ${a}; }
const listOfUnion${n}: (Union${n} | undefined)[] = [];
function fillUnion${n}(): void {
    { const made: Kind${b}.push(made); }
    { const made: Kind${c}.push(made); }
    { const made: Kind${d}.push(undefined);
    { const made: Kind${e}.push(made); }
    { const made: Kind${f}.push(made); }
    { const made: Kind${g}.push(made); }
    { const made: Kind${h}.push(made); }
    { const made: Kind${i}.push(undefined);
    { const made: Kind${j}.push(made); }
    { const made: Kind${k}.push(made); }
    { const made: Kind${l}.push(made); }
    { const made: Kind${m}.push(made); }
    { const made: Kind${o}.push(undefined);
    { const made: Kind${p}.push(made); }
    { const made: Kind${q}.push(made); }
    { const made: Kind${r}.push(made); }
}
fillUnion${n}();`,
      ],
      `function sumOfUnion13(): number { let sum = 0; for (let i = 0; i < listOfUnion13.length; i++) { const held: Union13 | undefined = listOfUnion13[i]; if (held) sum += held.id; else sum -= 1; } return sum; }
let total = 0;
for (let round = 0; round < 2000; round++) total += sumOfUnion0() + sumOfUnion1() + sumOfUnion2() + sumOfUnion3() + sumOfUnion4() + sumOfUnion5() + sumOfUnion6() + sumOfUnion7() + sumOfUnion8() + sumOfUnion9() + sumOfUnion10() + sumOfUnion11() + sumOfUnion12() + sumOfUnion13();
console.log(total);
console.log("Union0", sumOfUnion0(), describe(listOfUnion0[0]), describe(listOfUnion0[3]), describe(listOfUnion0[listOfUnion0.length - 1]));
console.log("Union1", sumOfUnion1(), describe(listOfUnion1[0]), describe(listOfUnion1[3]), describe(listOfUnion1[listOfUnion1.length - 1]));
console.log("Union2", sumOfUnion2(), describe(listOfUnion2[0]), describe(listOfUnion2[3]), describe(listOfUnion2[listOfUnion2.length - 1]));
console.log("Union3", sumOfUnion3(), describe(listOfUnion3[0]), describe(listOfUnion3[3]), describe(listOfUnion3[listOfUnion3.length - 1]));
console.log("Union4", sumOfUnion4(), describe(listOfUnion4[0]), describe(listOfUnion4[3]), describe(listOfUnion4[listOfUnion4.length - 1]));
console.log("Union5", sumOfUnion5(), describe(listOfUnion5[0]), describe(listOfUnion5[3]), describe(listOfUnion5[listOfUnion5.length - 1]));
console.log("Union6", sumOfUnion6(), describe(listOfUnion6[0]), describe(listOfUnion6[3]), describe(listOfUnion6[listOfUnion6.length - 1]));
console.log("Union7", sumOfUnion7(), describe(listOfUnion7[0]), describe(listOfUnion7[3]), describe(listOfUnion7[listOfUnion7.length - 1]));
console.log("Union8", sumOfUnion8(), describe(listOfUnion8[0]), describe(listOfUnion8[3]), describe(listOfUnion8[listOfUnion8.length - 1]));
console.log("Union9", sumOfUnion9(), describe(listOfUnion9[0]), describe(listOfUnion9[3]), describe(listOfUnion9[listOfUnion9.length - 1]));
console.log("Union10", sumOfUnion10(), describe(listOfUnion10[0]), describe(listOfUnion10[3]), describe(listOfUnion10[listOfUnion10.length - 1]));
console.log("Union11", sumOfUnion11(), describe(listOfUnion11[0]), describe(listOfUnion11[3]), describe(listOfUnion11[listOfUnion11.length - 1]));
console.log("Union12", sumOfUnion12(), describe(listOfUnion12[0]), describe(listOfUnion12[3]), describe(listOfUnion12[listOfUnion12.length - 1]));
console.log("Union13", sumOfUnion13(), describe(listOfUnion13[0]), describe(listOfUnion13[3]), describe(listOfUnion13[listOfUnion13.length - 1]));
`,
    ),
  });
