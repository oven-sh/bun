#!/usr/bin/env python3
"""values-wider-than-their-types.py <seed>: one program a seed. As plain Bun or a throw.
A value that the checker takes for a number, a string, a boolean or a record and that is something else when the program runs: an element out of range, a hole, a variable read before it is set,
a member that JSON.parse did not bring, an argument that run-time text left out, a narrowing that a call undoes, a store through a wider type, an integer that a side path replaces by a fraction.
Each is crossed with everything that is computed from it (arithmetic, comparisons, bit operations, templates, Math, indices, lengths, switch, tests), in place, through a constant,
through a parameter of a function value and through a named function that is called directly.
A compiler that types a result from the type its operand had when the expression was built, and widens the operand later, prints another VALUE here. A TypeError is allowed; another value is not.
Every program type checks without a suppression, and plain Bun runs it to its end. Each line of output: <carrier> | <computation>: <typeof> <value>, or THROWS <name>.
`list` prints the names of the sources, `numbered` their seeds; a name stands for its seed."""
import os, sys

HEAD = r'''function show(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}
function say(label: string, make: () => unknown): void {
  let text: string;
  try { text = show(make()); } catch (error) { text = "THROWS " + (error as Error).constructor.name; }
  console.log(label + ": " + text);
}
const sample: number[] = [10, 20, 30, 40];
const word: string = "abcdef";
const int32s = new Int32Array(2);
const float64s = new Float64Array(2);
const kept: { size: number } = { size: 1 };
function plusOne(n: number): number { return n + 1; }
function which(n: number): string { switch (n) { case 3: return "three"; case 0: return "zero"; case 1: return "one"; default: return "other"; } }
'''

# computations over a number: $ is the operand
NUMBER = [
    ("plus one", "$ + 1"), ("one plus", "1 + $"), ("minus one", "$ - 1"), ("ten minus", "10 - $"), ("times two", "$ * 2"), ("times itself", "$ * $"), ("plus itself", "$ + $"),
    ("divided", "$ / 2"), ("divides", "6 / $"), ("remainder", "$ % 2"), ("remainder of", "7 % $"), ("to a power", "$ ** 2"), ("as a power", "2 ** $"),
    ("negated", "-$"), ("unary plus", "+$"), ("bitwise not", "~$"), ("or zero", "$ | 0"), ("and seven", "$ & 7"), ("xor one", "$ ^ 1"),
    ("shifted left", "$ << 1"), ("shifted right", "$ >> 1"), ("unsigned shift", "$ >>> 0"), ("shifts one", "1 << $"),
    ("incremented", "(() => { let t = $; t++; return t; })()"), ("decremented", "(() => { let t = $; --t; return t; })()"), ("the old value of ++", "(() => { let t = $; return t++; })()"),
    ("added to", "(() => { let t = $; t += 2; return t; })()"), ("adds to", "(() => { let t = 2; t += $; return t; })()"), ("multiplies", "(() => { let t = 2; t *= $; return t; })()"),
    ("less than", "$ < 5"), ("at most", "$ <= 5"), ("greater than", "$ > 5"), ("at least", "$ >= 0"), ("five less than", "5 < $"),
    ("strictly equal", "$ === 3"), ("strictly unequal", "$ !== 3"), ("equal to itself", "$ === $"), ("loosely equal to null", "$ == null"), ("is undefined", "$ === undefined"),
    ("in a template", "`${$}`"), ("a sum in a template", "`${$ + 1}`"), ("a product in a template", "`<${$ * 2}>`"), ("joined to text", '"" + $'), ("text joined", '$ + ""'), ("String", "String($)"),
    ("Math.max", "Math.max($, 1)"), ("Math.min", "Math.min($, 1)"), ("Math.floor", "Math.floor($)"), ("Math.ceil", "Math.ceil($)"), ("Math.round", "Math.round($)"), ("Math.trunc", "Math.trunc($)"),
    ("Math.abs", "Math.abs($)"), ("Math.sign", "Math.sign($)"), ("Math.sqrt", "Math.sqrt($)"), ("Math.imul", "Math.imul($, 3)"), ("Math.clz32", "Math.clz32($)"), ("Math.fround", "Math.fround($)"), ("Math.pow", "Math.pow($, 2)"), ("Math.hypot", "Math.hypot($, 4)"),
    ("isNaN", "isNaN($)"), ("Number.isNaN", "Number.isNaN($)"), ("Number.isInteger", "Number.isInteger($)"), ("Number.isFinite", "Number.isFinite($)"), ("Number", "Number($)"),
    ("as an index", "sample[$]"), ("as an index, plus one", "sample[$ + 1]"), ("as an index of text", "word[$]"), ("charAt", "word.charAt($)"), ("charCodeAt", "word.charCodeAt($)"), ("slice", "word.slice($)"), ("array slice", "sample.slice($).length"), ("at", "sample.at($)"),
    ("as a length", "new Array<number>(($ | 0) & 3).length"), ("repeat", 'word.repeat(($ >>> 0) & 1)'),
    ("switch", '(() => { switch ($) { case 3: return "three"; case 0: return "zero"; case 1: return "one"; default: return "other"; } })()'), ("switch in a function", "which($)"), ("switch on a sum", '(() => { switch ($ + 1) { case 4: return "four"; case 1: return "one"; case 0: return "zero"; default: return "other"; } })()'),
    ("tested", '$ ? "yes" : "no"'), ("not", "!$"), ("or seven", "$ || 7"), ("and seven, lazily", "$ && 7"), ("if nullish seven", "$ ?? 7"), ("typeof", "typeof $"), ("typeof a sum", "typeof ($ + 1)"),
    ("in an array", "[$]"), ("in an object", "({ v: $ })"), ("a sum in an array", "[$ + 1]"), ("JSON", "JSON.stringify([$, $ + 1])"),
    ("bounds a loop", "(() => { let turns = 0; for (let i = 0; i < $ && i < 9; i++) turns++; return turns; })()"), ("starts a loop", "(() => { let turns = 0; for (let i = $; i < 5 && turns < 9; i++) turns++; return turns; })()"),
    ("summed in a loop", "(() => { let sum = 0; for (let i = 0; i < 3; i++) sum += $; return sum; })()"),
    ("to an Int32Array", "(() => { int32s[0] = $; return int32s[0]; })()"), ("to a Float64Array", "(() => { float64s[0] = $; return float64s[0]; })()"),
    ("to a number field", "(() => { kept.size = $; const read = kept.size + 1; kept.size = 1; return read; })()"), ("added to a field", "(() => { kept.size += $; const read = kept.size; kept.size = 1; return read; })()"),
    ("passed on, added there", "plusOne($)"), ("Object.is undefined", "Object.is($, undefined)"), ("Object.is NaN of a sum", "Object.is($ + 1, NaN)"), ("toFixed", "$.toFixed(1)"), ("toString", "$.toString()"),
    ("times one", "$ * 1"), ("plus zero", "$ + 0"), ("minus zero", "$ - 0"), ("divided by one", "$ / 1"), ("to the power one", "$ ** 1"), ("not not, bitwise", "~~$"), ("negated twice", "-(-$)"), ("valueOf", "$.valueOf()"),
    ("or zero, plus one", "($ | 0) + 1"), ("a sum of sums", "($ + 1) + ($ + 2)"), ("a sum, then a product", "($ + 1) * 2"), ("a sum kept, then used", "(() => { const sum = $ + 1; const twice = sum * 2; return twice - 1; })()"), ("a sum compared", "$ + 1 === 1"), ("a sum tested", '$ + 1 ? "yes" : "no"'),
    ("a conditional sum", "($ > 1 ? $ : 0) + 1"), ("the larger", "$ > 2 ? $ : 2"), ("compared with a sum", "$ + 1 > $"),
]

# name: (declarations, the operand or None, how a typed callback is called with it, text after the lines, further files)
def by_value(v): return "const call = (f: (n: number) => unknown): unknown => f(%s);" % v
S = {}
def source(name, declarations, operand, call=None, after="", files=None):
    S[name] = (declarations, operand, call or by_value(operand), after, files or {})

source("element-out-of-range", "const list: number[] = [1, 2, 3];", "list[7]")
source("element-at-a-negative-index", "const list: number[] = [1, 2, 3];\nlet back = -1;", "list[back]")
source("hole-of-the-array-constructor", "const list: number[] = new Array<number>(3);\nlist[0] = 1;", "list[1]")
source("hole-by-length", "const list: number[] = [1, 2];\nlist.length = 5;", "list[3]")
source("hole-by-delete", "const list: number[] = [1, 2, 3];\ndelete list[1];", "list[1]")
source("hole-by-a-far-store", "const list: number[] = [1, 2];\nlist[6] = 3;", "list[4]")
source("typed-array-out-of-range", "const ints = new Int32Array(2);\nints[0] = 3;", "ints[5]")
source("float-array-out-of-range", "const floats = new Float64Array(2);\nfloats[0] = 3;", "floats[5]")
source("let-read-before-it-is-set", "let late: number;\nconst readLate = (): number => late;", "readLate()", after="late = 3;\nsay(\"set at last\", () => readLate() + 1);")
source("let-read-in-a-closure-before-it-is-set", "let late: number;", "late", after="late = 3;\nsay(\"set at last\", () => late + 1);")
source("let-declared-with-an-assertion", "let late!: number;", "late", after="late = 3;\nsay(\"set at last\", () => late + 1);")
source("field-declared-with-an-assertion", "class Holder { count!: number; }\nconst holder = new Holder();", "holder.count", after="holder.count = 3;\nsay(\"set at last\", () => holder.count + 1);")
source("field-read-by-the-base-constructor", "let seen: number = 0;\nclass Base { constructor() { seen = this.peekAtTheField(); } peekAtTheField(): number { return 1; } }\nclass Derived extends Base { n: number = 3; peekAtTheField(): number { return this.n; } }\nnew Derived();", "seen")
source("index-signature", "const dictionary: Record<string, number> = { a: 1, b: 2 };", 'dictionary["missing"]')
source("index-signature-by-name", "const dictionary: { [name: string]: number } = { a: 1, b: 2 };", "dictionary.missing")
source("array-pattern", "const pair: number[] = [1, 2];\nconst [, , third] = pair;", "third")
source("object-pattern-of-an-index-signature", "const dictionary: Record<string, number> = { a: 1 };\nconst { missing } = dictionary;", "missing")
source("pattern-default-met-by-null", "const given: { a?: number } = JSON.parse('{\"a\":null}');\nconst { a = 1 } = given;", "a")
source("json-member-absent", "const given: { n: number } = JSON.parse(\"{}\");", "given.n")
source("json-member-null", "const given: { n: number } = JSON.parse('{\"n\":null}');", "given.n")
source("json-member-text", "const given: { n: number } = JSON.parse('{\"n\":\"3\"}');", "given.n")
source("json-member-fraction", "const made: { n: number } = { n: 3 };\nconst given: { n: number } = JSON.parse('{\"n\":3.5}');\nsay(\"made\", () => made.n + 1);", "given.n")
source("json-member-large", "const made: { n: number } = { n: 3 };\nconst given: { n: number } = JSON.parse('{\"n\":4294967296}');\nsay(\"made\", () => made.n + 1);", "given.n")
source("json-member-negative-zero", "const made: { n: number } = { n: 3 };\nconst given: { n: number } = JSON.parse('{\"n\":-0}');\nsay(\"made\", () => made.n + 1);", "given.n")
source("json-element-absent", "const given: number[] = JSON.parse(\"[1]\");", "given[3]")
source("json-element-null", "const given: number[] = JSON.parse(\"[null, 1]\");", "given[0]")
source("argument-left-out-by-reflect-apply", "", None, "const call = (f: (n: number) => unknown): unknown => Reflect.apply(f, undefined, []);")
source("argument-left-out-by-run-time-text", "", None, 'const call = new Function("f", "return f()") as (f: (n: number) => unknown) => unknown;')
source("argument-of-text-by-run-time-text", "", None, 'const call = new Function("f", "return f(\'3\')") as (f: (n: number) => unknown) => unknown;')
source("array-like-without-elements", "", None, "const call = (f: (n: number) => unknown): unknown => Array.from<number, unknown>({ length: 1 }, n => f(n))[0];")
source("hole-met-by-array-from", "const list: number[] = new Array<number>(2);", None, "const call = (f: (n: number) => unknown): unknown => Array.from(list, n => f(n))[0];")
source("hole-met-by-for-of", "const list: number[] = new Array<number>(1);", None, "const call = (f: (n: number) => unknown): unknown => { for (const n of list) return f(n); return \"no turn\"; };")
source("hole-met-by-spread", "const list: number[] = new Array<number>(1);", "[...list][0]")
source("generator-resumed-with-nothing", "function* steps(f: (n: number) => unknown): Generator<number, unknown, number> { const got = yield 1; return f(got); }", None, "const call = (f: (n: number) => unknown): unknown => { const it = steps(f); it.next(); return it.next().value; };")
source("getter-over-a-missing-element", "const list: number[] = [1, 2];\nconst holder = { get n(): number { return list[7]; } };", "holder.n")
source("class-getter-over-a-missing-element", "const list: number[] = [1, 2];\nclass Holder { get n(): number { return list[7]; } }\nconst holder = new Holder();", "holder.n")
source("result-of-a-missing-element", "const list: number[] = [1, 2];\nfunction pick(i: number): number { return list[i]; }", "pick(7)")
source("narrowing-undone-by-a-call", "let current: number | undefined = 3;\nfunction clear(): void { current = undefined; }\nfunction after(f: (n: number) => unknown): unknown { current = 3; clear(); return f(current); }", None, "const call = after;")
source("narrowed-field-undone-by-a-call", "const holder: { n: number | undefined } = { n: 3 };\nfunction clear(): void { holder.n = undefined; }\nfunction after(f: (n: number) => unknown): unknown { holder.n = 3; if (holder.n === undefined) return \"never\"; clear(); return f(holder.n); }", None, "const call = after;")
source("array-seen-through-a-wider-type", "const list: number[] = [1];\nconst wider: (number | undefined)[] = list;\nwider.push(undefined);", "list[1]")
source("array-of-text-through-a-wider-type", "const list: number[] = [1];\nconst wider: (number | string)[] = list;\nwider.push(\"3\");", "list[1]")
source("field-written-through-a-wider-type", "const holder: { n: number } = { n: 1 };\nconst wider: { n: number | undefined } = holder;\nwider.n = undefined;", "holder.n")
source("field-of-text-through-a-wider-type", "const holder: { n: number } = { n: 1 };\nconst wider: { n: number | string } = holder;\nwider.n = \"3\";", "holder.n")
source("method-with-a-narrower-parameter", "interface Runner { run(n: number | undefined, f: (n: number) => unknown): unknown }\nconst runner: Runner = { run(n: number, f: (n: number) => unknown) { return f(n); } };", None, "const call = (f: (n: number) => unknown): unknown => runner.run(undefined, f);")
source("optional-member-spread-as-undefined", "const part: { n?: number } = { n: undefined };\nconst whole = { n: 1, ...part };", "whole.n")
source("object-assign-of-undefined", "const holder: { n: number } = { n: 1 };\nconst part: { n?: number } = { n: undefined };\nObject.assign(holder, part);", "holder.n")
source("char-code-out-of-range", "const text: string = \"abc\";", "text.charCodeAt(9)")
source("parse-int-of-no-number", "const text: string = \"x\";", "parseInt(text, 10)")
source("math-max-of-nothing", "const none: number[] = [];", "Math.max(...none)")
source("index-of-nothing", "const list: number[] = [1, 2];", "list.indexOf(9)")
source("promise-resolved-with-nothing", "let settled: number = 0;\nawait new Promise<number>(resolve => { (resolve as () => void)(); }).then(n => { settled = n; });", "settled")
source("untyped-module-with-a-promise-in-a-comment", 'import { give } from "./untyped.js";', "give()", files={"untyped.js": "/** @returns {number} */\nexport function give() { return globalThis.nothingOfThatName; }\n"})
source("untyped-module-calls-back", 'import { callBack } from "./untyped.js";', None, "const call = (f: (n: number) => unknown): unknown => callBack(f);", files={"untyped.js": "/** @param {(n: number) => unknown} f */\nexport function callBack(f) { return f(); }\n"})
source("caught-value", "function thrown(): number { try { throw undefined; } catch (error: any) { return error; } }", "thrown()")
# behind `x!`
source("non-null-assertion-on-an-unset-variable", "let maybe: number | undefined;", "maybe!", after="maybe = 3;\nsay(\"set at last\", () => maybe! + 1);")
source("map-entry-asserted", 'const byName = new Map<string, number>([["a", 3]]);', 'byName.get("b")!')
# integers at the ends of their ranges: nothing is absent, but the checker types by integer ranges
for name, value in (("largest-int32", "2147483647"), ("smallest-int32", "-2147483648"), ("zero", "0"), ("minus-one", "-1"), ("largest-uint32", "4294967295"), ("two-to-the-53", "9007199254740992"), ("large-for-a-template", "1e21"), ("a-fraction", "0.5")):
    source("integer-range-" + name, "let held = %s;\nconst holder = { n: %s };\nfunction give(): number { return holder.n; }" % (value, value), "held")
    source("integer-range-field-" + name, "const holder = { n: %s };" % value, "holder.n")


# a place that only integers are seen to enter, and a value of another kind that arrives by a side path which TypeScript accepts without a cast
VALUES = (("a-fraction", "0.5"), ("beyond-int32", "2147483648"), ("negative-zero", "-0"), ("not-a-number", "NaN"))
ARRAY_PATHS = (
    ("push", "list.push(@);", "list[3]"), ("unshift", "list.unshift(@);", "list[0]"), ("fill", "list.fill(@);", "list[1]"), ("splice", "list.splice(1, 1, @);", "list[1]"),
    ("a-store-through-a-second-name", "const same = list;\nsame[1] = @;", "list[1]"), ("a-store-in-a-function", "function put(all: number[], v: number): void { all[1] = v; }\nput(list, @);", "list[1]"),
    ("reflect-set", "Reflect.set(list, 1, @);", "list[1]"), ("object-assign", "Object.assign(list, [@]);", "list[0]"), ("push-by-call", "Array.prototype.push.call(list, @);", "list[3]"),
    ("for-each-over-itself", "list.forEach((v, i, all) => { all[i] = @; });", "list[1]"), ("a-pattern", "[list[1]] = [@];", "list[1]"), ("with", "const other = list.with(1, @);", "other[1]"),
    ("map", "const other = list.map(() => @);", "other[1]"), ("concat", "const other = list.concat([@]);", "other[3]"), ("spread", "const other = [...list, @];", "other[3]"), ("array-from", "const other = Array.from(list, () => @);", "other[1]"),
    ("define-property", "Object.defineProperty(list, 1, { value: @, writable: true, enumerable: true, configurable: true });", "list[1]"),
)
FIELD_PATHS = (
    ("an-index-signature", "const bag: Record<string, number> = holder;\nbag[\"n\"] = @;", "holder.n"), ("an-index-signature-by-name", "const bag: { [name: string]: number } = holder;\nbag.n = @;", "holder.n"),
    ("object-assign", "Object.assign(holder, { n: @ });", "holder.n"), ("reflect-set", "Reflect.set(holder, \"n\", @);", "holder.n"),
    ("define-property", "Object.defineProperty(holder, \"n\", { value: @, writable: true, enumerable: true, configurable: true });", "holder.n"),
    ("a-key-in-a-variable", "const key: keyof typeof holder = \"n\";\nholder[key] = @;", "holder.n"), ("for-in", "for (const key in holder) holder[key as keyof typeof holder] = @;", "holder.n"),
    ("a-pattern", "({ n: holder.n } = { n: @ });", "holder.n"), ("an-array-pattern", "[holder.n] = [@];", "holder.n"), ("a-store-in-a-function", "function put(o: { n: number }, v: number): void { o.n = v; }\nput(holder, @);", "holder.n"),
    ("a-second-name", "const same = holder;\nsame.n = @;", "holder.n"), ("a-spread-copy", "const copy = { ...holder, n: @ };", "copy.n"), ("a-getter-defined-later", "Object.defineProperty(holder, \"n\", { get() { return @; }, enumerable: true, configurable: true });", "holder.n"),
)
VARIABLE_PATHS = (
    ("an-array-pattern", "[held] = [@];", "held"), ("an-object-pattern", "({ held } = { held: @ });", "held"), ("for-of", "for (held of [@]) {}", "held"), ("a-closure", "const set = (v: number): void => { held = v; };\nset(@);", "held"),
    ("a-pattern-default", "const nothing: { v?: number } = {};\n({ v: held = @ } = nothing);", "held"), ("a-callback", "[@].forEach(v => { held = v; });", "held"),
)
for value_name, value in VALUES:
    for path, how, operand in ARRAY_PATHS: source("integers-only-array-then-%s-by-%s" % (value_name, path), "const list: number[] = [1, 2, 3];\n" + how.replace("@", value), operand)
    for path, how, operand in FIELD_PATHS: source("integers-only-field-then-%s-by-%s" % (value_name, path), "const holder = { n: 3 };\n" + how.replace("@", value), operand)
    for path, how, operand in VARIABLE_PATHS: source("integers-only-variable-then-%s-by-%s" % (value_name, path), "let held = 3;\n" + how.replace("@", value), operand)
# what a compound assignment or a repeated operation makes of an integer
for name, start, how in (("halved", "3", "held /= 2;"), ("to-a-negative-power", "2", "held **= -1;"), ("remainder-by-zero", "3", "held %= 0;"), ("times-minus-one-of-zero", "0", "held *= -1;"), ("negated-zero", "0", "held = -held;"),
                         ("incremented-past-int32", "2147483647", "held++;"), ("decremented-past-int32", "-2147483648", "held--;"), ("squared-five-times", "3", "for (let i = 0; i < 5; i++) held *= held;"), ("squared-seven-times", "3", "for (let i = 0; i < 7; i++) held *= held;"),
                         ("doubled-sixty-times", "1", "for (let i = 0; i < 60; i++) held += held;"), ("shifted-to-the-sign", "1", "held <<= 31;"), ("made-unsigned", "-1", "held >>>= 0;"), ("divided-by-zero", "3", "held /= 0;"), ("rounded-to-negative-zero", "3", "held = Math.round(-0.4);"),
                         ("remainder-with-a-negative-zero", "-4", "held %= 2;"), ("summed-past-two-to-the-53", "9007199254740991", "held += 2;")):
    source("integer-variable-" + name, "let held = %s;\n%s" % (start, how), "held")
    source("integer-field-" + name, "const holder = { held: %s };\n%s" % (start, how.replace("held", "holder.held")), "holder.held")
    source("integer-element-" + name, "const list: number[] = [%s];\n%s" % (start, how.replace("held", "list[0]")), "list[0]")
# narrowing that a call undoes, computed on in place: @ is the computation
BLOCKS = {}
def block(name, declarations, text, operand): BLOCKS[name] = (declarations, text, operand)
block("in-place-narrowing-undone-by-a-call", "let current: number | undefined = 3;\nfunction clear(): void { current = undefined; }", "current = 3; clear(); return @;", "current")
block("in-place-narrowed-field-undone-by-a-call", "const holder: { n: number | undefined } = { n: 3 };\nfunction clear(): void { holder.n = undefined; }", "holder.n = 3; clear(); return @;", "holder.n")
block("in-place-tested-field-undone-by-a-call", "const holder: { n?: number } = { n: 3 };\nfunction clear(): void { delete holder.n; }", "holder.n = 3; if (holder.n === undefined) return \"never\"; clear(); return @;", "holder.n")
block("in-place-narrowing-to-null-undone", "let current: number | null = 3;\nfunction clear(): void { current = null; }", "current = 3; clear(); return @;", "current")
block("in-place-narrowing-to-text-undone", "let current: number | string = 3;\nfunction change(): void { current = \"3\"; }", "current = 3; change(); return @;", "current")
block("in-place-narrowed-field-to-text-undone", "const holder: { n: number | string } = { n: 3 };\nfunction change(): void { holder.n = \"3\"; }", "holder.n = 3; change(); return @;", "holder.n")
block("in-place-typeof-test-undone", "let current: number | string = 3;\nfunction change(): void { current = \"3\"; }", "current = 3 as number | string; if (typeof current !== \"number\") return \"never\"; change(); return @;", "current")
block("in-place-narrowing-undone-by-a-getter", "let current: number | undefined = 3;\nconst trap = { get touch(): number { current = undefined; return 0; } };", "current = 3; trap.touch; return @;", "current")
block("in-place-narrowing-undone-in-the-expression", "let current: number | undefined = 3;\nfunction clear(): number { current = undefined; return 0; }", "current = 3; const zero = clear(); return [zero, @][1];", "current")
block("in-place-element-narrowed-and-undone", "const list: (number | undefined)[] = [3];\nfunction clear(): void { list[0] = undefined; }", "list[0] = 3; const at = 0; if (list[at] === undefined) return \"never\"; clear(); return @;", "list[0]!")
block("in-place-tested-variable-undone-by-a-call", "let current: number | undefined = 3;\nfunction clear(): void { current = undefined; }\nfunction fill(): void { current = 3; }", "fill(); if (current === undefined) return \"never\"; clear(); return @;", "current")
block("in-place-local-undone-by-a-closure", "", "let local: number | undefined = 3; const clear = (): void => { local = undefined; }; local = 3; clear(); return @;", "local")
block("in-place-local-tested-and-undone-by-a-closure", "function three(): number | undefined { return 3; }", "let local = three(); const clear = (): void => { local = undefined; }; if (local === undefined) return \"never\"; clear(); return @;", "local")
block("in-place-class-field-undone-by-a-method", "class Holder { n: number | undefined = 3; clear(): void { this.n = undefined; } }\nconst holder = new Holder();", "holder.n = 3; holder.clear(); return @;", "holder.n")
block("in-place-this-field-undone-by-a-method", "class Holder { n: number | undefined = 3; clear(): void { this.n = undefined; } use(f: (self: Holder) => unknown): unknown { return f(this); } }\nconst holder = new Holder();", "return holder.use(self => { self.n = 3; self.clear(); return @; });", "self.n")
block("in-place-narrowing-undone-by-a-callback", "let current: number | undefined = 3;", "current = 3; [0].forEach(() => { current = undefined; }); return @;", "current")
block("in-place-narrowing-undone-by-a-setter", "let current: number | undefined = 3;\nconst trap = { set touch(v: number) { current = undefined; } };", "current = 3; trap.touch = 1; return @;", "current")
block("in-place-narrowing-undone-by-a-conversion", "let current: number | undefined = 3;\nconst trap = { toString(): string { current = undefined; return \"t\"; } };", "current = 3; const text = `${trap}`; return text.length > 9 ? 0 : @;", "current")
block("in-place-narrowing-undone-by-a-constructor", "let current: number | undefined = 3;\nclass Clears { constructor() { current = undefined; } }", "current = 3; new Clears(); return @;", "current")
block("in-place-narrowing-of-a-fraction-undone", "let current: number | undefined = 3;\nfunction change(): void { current = 0.5; }", "current = 3; change(); return @;", "current")
block("in-place-literal-narrowing-undone", "let current: 3 | 4 | undefined = 3;\nfunction clear(): void { current = undefined; }", "current = 3; clear(); return @;", "(current as number)")
block("in-place-exported-variable-undone", "export let current: number | undefined = 3;\nexport function clear(): void { current = undefined; }", "current = 3; clear(); return @;", "current")
for name in BLOCKS: S[name] = None


# the same for text and for flags
TEXT = [
    ("alone in a template", "`${$}`"), ("joined to nothing", '$ + ""'), ("nothing joined", '"" + $'), ("toString", "$.toString()"), ("valueOf", "$.valueOf()"), ("or nothing", '$ || ""'), ("if nullish nothing", '$ ?? ""'), ("concat of nothing", "$.concat()"),
    ("joined", '$ + "x"'), ("joined to", '"x" + $'), ("joined to itself", "$ + $"), ("in a template", "`<${$}>`"), ("appended to", '(() => { let t = $; t += "x"; return t; })()'), ("appends", '(() => { let t = "x"; t += $; return t; })()'),
    ("length", "$.length"), ("length plus one", "$.length + 1"), ("length is zero", "$.length === 0"), ("length bounds a loop", "(() => { let turns = 0; for (let i = 0; i < $.length; i++) turns++; return turns; })()"),
    ("first", "$[0]"), ("charAt", "$.charAt(0)"), ("charCodeAt", "$.charCodeAt(0)"), ("slice", "$.slice(1)"), ("upper case", "$.toUpperCase()"), ("includes", '$.includes("a")'), ("concat", '$.concat("x")'), ("trim", "$.trim()"),
    ("strictly equal", '$ === "a"'), ("strictly unequal", '$ !== "a"'), ("equal to itself", "$ === $"), ("less than", '$ < "b"'), ("at least", '$ >= "a"'), ("loosely equal to null", "$ == null"), ("is undefined", "$ === undefined"), ("equal to the word undefined", '$ === "undefined"'),
    ("switch", '(() => { switch ($) { case "a": return "is a"; case "undefined": return "the word"; case "": return "empty"; default: return "other"; } })()'),
    ("tested", '$ ? "yes" : "no"'), ("not", "!$"), ("or a default", '$ || "d"'), ("if nullish a default", '$ ?? "d"'), ("and then", '$ && "then"'), ("typeof", "typeof $"), ("typeof joined", 'typeof ($ + "x")'),
    ("to a number", "+$"), ("Number", "Number($)"), ("parseInt", "parseInt($, 10)"), ("String", "String($)"), ("JSON", "JSON.stringify([$])"), ("in an array, joined", '[$, "z"].join("-")'), ("in an object", "({ v: $ })"),
    ("as a key read", "lookup[$]"), ("as a key stored", "(() => { const o: Record<string, number> = {}; o[$] = 1; return Object.keys(o).join(); })()"), ("as a key tested", "$ in lookup"), ("as a Map key", "new Map<string, number>([[$, 1]]).has(\"undefined\")"), ("in a Set", "new Set<string>([$, \"a\"]).size"),
    ("to a text field", '(() => { keptText.t = $; const read = keptText.t + "!"; keptText.t = "k"; return read; })()'), ("passed on, joined there", "shout($)"), ("compared by locale", '$.localeCompare("a")'), ("split", '$.split("").length'), ("repeat", "$.repeat(2)"),
]
FLAG = [
    ("true or false", "$ ? true : false"), ("false or true", "$ ? false : true"), ("or false", "$ || false"), ("and true", "$ && true"), ("if nullish false", "$ ?? false"), ("is true, as a flag", "$ === true ? true : false"), ("is not false", "$ !== false"), ("valueOf", "$.valueOf()"),
    ("tested", '$ ? "yes" : "no"'), ("not", "!$"), ("not not", "!!$"), ("is true", "$ === true"), ("is false", "$ === false"), ("is not true", "$ !== true"), ("equal to itself", "$ === $"), ("loosely equal to null", "$ == null"), ("loosely equal to false", "$ == false"), ("is undefined", "$ === undefined"),
    ("to a number", "+$"), ("Number", "Number($)"), ("and then", "$ && 1"), ("or else", "$ || 2"), ("if nullish", "$ ?? 3"),
    ("in a template", "`<${$}>`"), ("String", "String($)"), ("joined to text", '"" + $'), ("typeof", "typeof $"), ("JSON", "JSON.stringify([$])"), ("in an object", "({ v: $ })"),
    ("switch", '(() => { switch ($) { case true: return "true"; case false: return "false"; default: return "neither"; } })()'), ("if not", '(() => { if (!$) return "not"; return "is"; })()'), ("if is false", '(() => { if ($ === false) return "false"; return "not false"; })()'),
    ("bounds a loop", "(() => { let turns = 0; while ($ && turns < 3) turns++; return turns; })()"), ("counted", "(() => { let n = 0; if ($) n++; if (!$) n += 10; return n; })()"), ("both ways", '($ ? 1 : 0) + (!$ ? 10 : 0)'),
    ("to a flag field", "(() => { keptFlag.f = $; const read = keptFlag.f ? 1 : 2; keptFlag.f = true; return read; })()"), ("passed on, tested there", "pickFlag($)"), ("xor", "$ !== true !== false"), ("in an array", "[$]"), ("Boolean", "Boolean($)"),
]
MORE_HEAD = r"""const lookup: Record<string, number> = { a: 1, undefined: 2 };
const keptText: { t: string } = { t: "k" };
const keptFlag: { f: boolean } = { f: true };
function shout(text: string): string { return text + "!"; }
function pickFlag(flag: boolean): string { return flag ? "picked" : "left"; }
function isOn(): boolean { return true; }
"""
KIND = {}
def absent(prefix, T, a, b, other, computations):
    def add(name, declarations, operand, call=None, after=""):
        full = prefix + "-" + name
        S[full] = (declarations, operand, call or "const call = (f: (n: %s) => unknown): unknown => f(%s);" % (T, operand), after, {})
        KIND[full] = (T, computations)
    F = "(n: %s) => unknown" % T
    add("element-out-of-range", "const list: %s[] = [%s, %s];" % (T, a, b), "list[7]")
    add("hole-of-the-array-constructor", "const list: %s[] = new Array<%s>(3);\nlist[0] = %s;" % (T, T, a), "list[1]")
    add("hole-by-delete", "const list: %s[] = [%s, %s];\ndelete list[1];" % (T, a, b), "list[1]")
    add("index-signature", "const dictionary: Record<string, %s> = { a: %s };" % (T, a), 'dictionary["missing"]')
    add("let-read-in-a-closure-before-it-is-set", "let late: %s;" % T, "late", after="late = %s;" % a)
    add("let-declared-with-an-assertion", "let late!: %s;" % T, "late", after="late = %s;" % a)
    add("field-declared-with-an-assertion", "class Holder { held!: %s; }\nconst holder = new Holder();" % T, "holder.held")
    add("field-read-by-the-base-constructor", "let seen: %s = %s;\nclass Base { constructor() { seen = this.peekAtTheField(); } peekAtTheField(): %s { return %s; } }\nclass Derived extends Base { n: %s = %s; peekAtTheField(): %s { return this.n; } }\nnew Derived();" % (T, a, T, a, T, b, T), "seen")
    add("array-pattern", "const pair: %s[] = [%s];\nconst [, second] = pair;" % (T, a), "second")
    add("json-member-absent", "const given: { n: %s } = JSON.parse(\"{}\");" % T, "given.n")
    add("json-member-null", "const given: { n: %s } = JSON.parse('{\"n\":null}');" % T, "given.n")
    add("json-member-of-another-kind", "const given: { n: %s } = JSON.parse('{\"n\":%s}');" % (T, other), "given.n")
    add("json-element-absent", "const given: %s[] = JSON.parse(\"[]\");" % T, "given[0]")
    add("argument-left-out-by-reflect-apply", "", None, "const call = (f: %s): unknown => Reflect.apply(f, undefined, []);" % F)
    add("argument-left-out-by-run-time-text", "", None, 'const call = new Function("f", "return f()") as (f: %s) => unknown;' % F)
    add("generator-resumed-with-nothing", "function* steps(f: %s): Generator<number, unknown, %s> { const got = yield 1; return f(got); }" % (F, T), None, "const call = (f: %s): unknown => { const it = steps(f); it.next(); return it.next().value; };" % F)
    add("array-seen-through-a-wider-type", "const list: %s[] = [%s];\nconst wider: (%s | undefined)[] = list;\nwider.push(undefined);" % (T, a, T), "list[1]")
    add("field-written-through-a-wider-type", "const holder: { n: %s } = { n: %s };\nconst wider: { n: %s | undefined } = holder;\nwider.n = undefined;" % (T, a, T), "holder.n")
    add("optional-member-spread-as-undefined", "const part: { n?: %s } = { n: undefined };\nconst whole = { n: %s, ...part };" % (T, a), "whole.n")
    add("getter-over-a-missing-element", "const list: %s[] = [%s];\nconst holder = { get n(): %s { return list[7]; } };" % (T, a, T), "holder.n")
    add("result-of-a-missing-element", "const list: %s[] = [%s];\nfunction take(i: number): %s { return list[i]; }" % (T, a, T), "take(7)")
    full = prefix + "-in-place-narrowing-undone-by-a-call"
    BLOCKS[full] = ("let current: %s | undefined = %s;\nfunction clear(): void { current = undefined; }" % (T, a), "current = %s; clear(); return @;" % ("isOn()" if T == "boolean" else a), "current"); S[full] = None; KIND[full] = (T, computations)
    full = prefix + "-in-place-narrowed-field-undone-by-a-call"
    BLOCKS[full] = ("const holder: { n: %s | undefined } = { n: %s };\nfunction clear(): void { holder.n = undefined; }" % (T, a), "holder.n = %s; clear(); return @;" % ("isOn()" if T == "boolean" else a), "holder.n"); S[full] = None; KIND[full] = (T, computations)
RECORD = [
    ("tested", '$ ? "some" : "none"'), ("not", "!$"), ("not not", "!!$"), ("Boolean", "Boolean($)"), ("if not", '(() => { if (!$) return "none"; return "some"; })()'), ("if", '(() => { if ($) return "some"; return "none"; })()'),
    ("is undefined", "$ === undefined"), ("is not undefined", "$ !== undefined"), ("loosely equal to null", "$ == null"), ("loosely unequal to null", "$ != null"), ("is null", "$ === null"), ("equal to itself", "$ === $"), ("typeof", "typeof $"), ("typeof is object", 'typeof $ === "object"'),
    ("read if there", "$?.id"), ("read if there, plus one", "($?.id ?? 0) + 1"), ("read if there, is undefined", "$?.id === undefined"), ("a method if there", "$?.name.toUpperCase()"), ("read", "$.id"), ("read, plus one", "$.id + 1"),
    ("and then read", "$ && $.id"), ("or a default", "($ || otherRow).id"), ("if nullish a default", "($ ?? otherRow).id"), ("a guarded read", "$ ? $.id : -1"), ("a guarded read, the otherRow way", "!$ ? -1 : $.id"), ("guarded by undefined", "$ === undefined ? -1 : $.id"), ("guarded loosely", "$ == null ? -1 : $.id"),
    ("String", "String($)"), ("in a template", "`<${$ === undefined ? \"nothing\" : $.name}>`"), ("JSON", "JSON.stringify([$])"), ("JSON of it", "String(JSON.stringify($))"), ("in an array", "[$].length"), ("in an object", "Object.keys({ v: $ }).join()"), ("spread", "Object.keys({ ...$ }).join()"),
    ("instanceof", "$ instanceof Object"), ("Object.is undefined", "Object.is($, undefined)"), ("counted", "(() => { let n = 0; if ($) n++; if (!$) n += 10; return n; })()"), ("bounds a loop", "(() => { let turns = 0; while ($ && turns < 3) turns++; return turns; })()"),
    ("to a record field", "(() => { keptRow.row = $; const read = keptRow.row ? 1 : 2; keptRow.row = otherRow; return read; })()"), ("passed on, tested there", "hasRow($)"), ("passed on, read if there", "idOf($)"), ("filtered", "[$, otherRow].filter(Boolean).length"), ("filtered by a test", "[$, otherRow].filter(row => !!row).length"), ("found", "[$, otherRow].findIndex(row => !row)"),
    ("switch on typeof", '(() => { switch (typeof $) { case "object": return "an object"; case "undefined": return "nothing"; default: return "otherRow"; } })()'),
]
MORE_HEAD += r"""interface Row { id: number; name: string }
const otherRow: Row = { id: 9, name: "other" };
const firstRow: Row = { id: 1, name: "first" };
const keptRow: { row: Row } = { row: otherRow };
function hasRow(row: Row): string { return row ? "has" : "has not"; }
function idOf(row: Row): number | undefined { return row?.id; }
"""
absent("record", "Row", "firstRow", "otherRow", "3", RECORD)
absent("text", "string", '"a"', '"b"', "3", TEXT)
absent("flag", "boolean", "true", "false", "1", FLAG)
S["text-character-out-of-range"] = ("const text: string = \"abc\";", "text[9]", "const call = (f: (n: string) => unknown): unknown => f(text[9]);", "", {}); KIND["text-character-out-of-range"] = ("string", TEXT)


# the value whose narrowing a call undid, moved one step before anything is computed from it
CLEARED = "let current: number | undefined = 3;\nfunction clear(): void { current = undefined; }\n"
def moved(name, declarations, text, operand):
    BLOCKS["moved-" + name] = (CLEARED + declarations, text, operand); S["moved-" + name] = None
moved("into-a-constant", "", "current = 3; clear(); const moved = current; return @;", "moved")
moved("into-a-let", "", "current = 3; clear(); let moved = 4; moved = current; return @;", "moved")
moved("into-a-module-variable", "let second: number = 4;", "current = 3; clear(); second = current; return @;", "second")
moved("into-a-field", "const box: { n: number } = { n: 0 };", "current = 3; clear(); box.n = current; return @;", "box.n")
moved("into-a-new-object", "", "current = 3; clear(); const made = { n: current }; return @;", "made.n")
moved("into-a-class-instance", "class Box { n: number; constructor(n: number) { this.n = n; } }", "current = 3; clear(); const made = new Box(current); return @;", "made.n")
moved("into-a-parameter-property", "class Box { constructor(public n: number) {} }", "current = 3; clear(); const made = new Box(current); return @;", "made.n")
moved("into-an-array", "", "current = 3; clear(); const made = [current]; return @;", "made[0]")
moved("into-an-array-by-push", "", "current = 3; clear(); const made: number[] = []; made.push(current); return @;", "made[0]")
moved("through-a-result", "function give(): number { current = 3; clear(); return current; }", "return @;", "give()")
moved("through-an-arrow-result", "const give = (): number => { current = 3; clear(); return current; };", "return @;", "give()")
moved("through-a-generic-identity", "function same<T>(v: T): T { return v; }", "current = 3; clear(); const moved = same(current); return @;", "moved")
moved("through-a-typed-identity", "function sameNumber(v: number): number { return v; }", "current = 3; clear(); const moved = sameNumber(current); return @;", "moved")
moved("through-two-calls", "function inner(v: number): number { return v; }\nfunction outer(v: number): number { return inner(v); }", "current = 3; clear(); const moved = outer(current); return @;", "moved")
moved("through-a-conditional", "", "current = 3; clear(); const moved = sample.length > 9 ? 4 : current; return @;", "moved")
moved("through-a-logical-or", "", "current = 3; clear(); const moved = (sample.length > 9 && 4) || current; return @;", "moved")
moved("into-a-closure", "", "current = 3; clear(); const moved = current; const use = (): unknown => @; return use();", "moved")
moved("through-a-method", "const tool = { same(v: number): number { return v; } };", "current = 3; clear(); const moved = tool.same(current); return @;", "moved")
moved("through-a-class-method", "class Tool { same(v: number): number { return v; } }\nconst tool = new Tool();", "current = 3; clear(); const moved = tool.same(current); return @;", "moved")
moved("through-a-static-method", "class Tool { static same(v: number): number { return v; } }", "current = 3; clear(); const moved = Tool.same(current); return @;", "moved")
moved("through-a-rest-parameter", "function firstOf(...all: number[]): number { return all[0]; }", "current = 3; clear(); const moved = firstOf(current); return @;", "moved")
moved("through-a-pattern", "", "current = 3; clear(); const { n: moved } = { n: current }; return @;", "moved")
moved("through-an-array-pattern", "", "current = 3; clear(); const [moved] = [current]; return @;", "moved")
moved("through-a-generator", "function* steps(): Generator<number> { current = 3; clear(); yield current; }", "for (const moved of steps()) return @; return \"no turn\";", "moved")
moved("through-a-map", "const held = new Map<string, number>();", "current = 3; clear(); held.set(\"k\", current); for (const moved of held.values()) return @; return \"no turn\";", "moved")
moved("through-a-set", "", "current = 3; clear(); for (const moved of new Set<number>([current])) return @; return \"no turn\";", "moved")
moved("through-await", "const awaited: number = await (async (): Promise<number> => { current = 3; clear(); return current; })();", "return @;", "awaited")
moved("through-a-promise", "current = 3; clear();\nconst awaited: number = await Promise.resolve(current);", "return @;", "awaited")
moved("through-a-callback", "function withValue(v: number, f: (n: number) => unknown): unknown { return f(v); }", "current = 3; clear(); return withValue(current, moved => @);", "moved")
moved("through-for-each", "", "current = 3; clear(); let result: unknown; [current].forEach(moved => { result = @; }); return result;", "moved")
moved("through-array-map", "", "current = 3; clear(); return [current].map(moved => @)[0];", "moved")
moved("into-a-default-parameter", "function withDefault(f: (n: number) => unknown, v: number = current as number): unknown { return f(v); }", "current = 3; clear(); return withDefault(moved => @);", "moved")
moved("through-a-getter", "const lens = { get now(): number { current = 3; clear(); return current; } };", "return @;", "lens.now")
moved("through-a-loop-variable", "", "current = 3; clear(); let moved = 4; for (let i = 0; i < 2; i++) moved = current; return @;", "moved")
moved("through-try-finally", "", "current = 3; clear(); let moved = 4; try { moved = current; } finally { sample.length; } return @;", "moved")

def program(name):
    T, computations = KIND.get(name, ("number", NUMBER))
    if name in BLOCKS:
        declarations, text, operand = BLOCKS[name]
        lines = [HEAD + MORE_HEAD, declarations]
        for number, (label, computation) in enumerate(computations):
            lines.append("say(%s, () => { %s });" % (quoted("after the call | " + label), text.replace("@", computation.replace("$", operand))))
            lines.append("function direct%d(n: %s): unknown { return %s; }" % (number, T, computation.replace("$", "n")))
            lines.append("say(%s, () => { %s });" % (quoted("after the call, a direct call | " + label), text.replace("@", "direct%d(%s)" % (number, operand))))
        lines.append("export {};")
        return "\n".join(lines) + "\n", {}
    declarations, operand, call, after, files = S[name]
    lines = [HEAD + MORE_HEAD, declarations, call]
    for number, (label, text) in enumerate(computations):
        if operand is not None:
            lines.append("function direct%d(n: %s): unknown { return %s; }" % (number, T, text.replace("$", "n")))
            lines.append("say(%s, () => direct%d(%s));" % (quoted("a direct call | " + label), number, operand))
            lines.append("say(%s, () => %s);" % (quoted("in place | " + label), text.replace("$", "(%s)" % operand if not simple(operand) else operand)))
            lines.append("say(%s, () => { const v = %s; return %s; });" % (quoted("a constant | " + label), operand, text.replace("$", "v")))
        lines.append("say(%s, () => call((n: %s) => %s));" % (quoted("a parameter | " + label), T, text.replace("$", "n")))
    lines.append(after)
    lines.append("export {};")
    return "\n".join(x for x in lines if x) + "\n", files

def simple(operand): return all(c.isalnum() or c in "._[]\"'()!" for c in operand)
def quoted(text): return '"' + text.replace('"', '\\"') + '"'

if __name__ == "__main__":
    if sys.argv[1] == "list": print("\n".join(S)); sys.exit(0)
    if sys.argv[1] == "numbered": print("\n".join("%d %s" % pair for pair in enumerate(S))); sys.exit(0)
    text, files = program(list(S)[int(sys.argv[1])] if sys.argv[1].isdigit() else sys.argv[1])
    if len(sys.argv) > 2:
        os.makedirs(sys.argv[2], exist_ok=True)
        open(os.path.join(sys.argv[2], "main.ts"), "w").write(text)
        for name, body in files.items(): open(os.path.join(sys.argv[2], name), "w").write(body)
    else: sys.stdout.write(text.rstrip("\n") + "".join("\n//// %s\n%s" % (name, body.rstrip("\n")) for name, body in files.items()) + "\n")
