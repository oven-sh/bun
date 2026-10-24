// One place in a program that sees two kinds of value, for the values that are no collections and no records: strings (a literal, a rope, a part of another string, of 8 and of 16 bits, a key, one that
// native code made), numbers, bigints, booleans, null, undefined, symbols, promises and thenables, functions of every sort, dates, patterns, errors. The other generators of this folder give every use one
// birth, so that nothing but that birth decides what the compiler believes there: none of them has a place that must hold two beliefs at once. A value of two kinds is kept as a tag and a payload, and
// whatever reads the payload of one kind may stand only behind the test of the tag.
//
// A program is one pair of births and one road by which the two reach the use. Every use is a function of its own in that program, and prints the answers it gave, each once, in the order they came.
// Across kinds a few births stand for their kind; within a kind every pair is made.
function parts() {
  const births: Record<string, string[]> = {
    // strings
    literal: ["string", '"abcd"'], empty: ["string", '""'], oneChar: ["string", '"a"'], latin: ["string", '"h\\u00e9llo"'], wide: ["string", '"\\u65e5\\u672c\\u8a9e"'], emoji: ["string", '"a\\u{1F600}b"'], digits: ["string", '"123"'], index: ["string", '"7"'],
    rope: ["string", '("abcdefgh" + one) + ("ijklmnop" + one)'], ropeWide: ["string", '("abcdefgh" + one) + "\\u65e5\\u672c"'], ropeDeep: ["string", '(() => { let t = ""; for (let i = 0; i < 20; i++) t += "ab" + i; return t; })()'],
    substring: ["string", '("xxabcdefghijklmnopqrstuvwxyzxx" + one).substring(2, 24)'], sliceOfLiteral: ["string", '"xxabcdxx".slice(2, 6)'], atom: ["string", "Object.keys({ abcd: 1 })[0]"], charOf: ["string", '"abcd"[one]'],
    fromBuffer: ["string", 'Buffer.from("abcd").toString()'], fromBufferWide: ["string", 'Buffer.from("\\u65e5\\u672c").toString()'], decoded: ["string", "new TextDecoder().decode(new Uint8Array([97, 98, 99]))"], parsed: ["string", "JSON.parse('\"abcd\"')§S"],
    fromCharCode: ["string", "String.fromCharCode(96 + one, 98)"], ofNumber: ["string", "String(one + 122)"], template: ["string", "`a${one}c`"], joined: ["string", '["a", "b", "c"].join("")'], upper: ["string", '"abcd".toUpperCase()'], platform: ["string", "process.platform"], href: ["string", 'new URL("http://a.example/b").href'], decodedWide: ["string", 'new TextDecoder("utf-16le").decode(new Uint8Array([97, 0, 229, 101]))'], fromLatin: ["string", 'Buffer.from([97, 233]).toString("latin1")'], toBase64: ["string", 'Buffer.from("abcd").toString("base64")'], headerValue: ["string", 'new Headers({ k: "abcd" }).get("k")§Q'], formatted: ["string", '(1234.5).toLocaleString("en")'], matchedGroup: ["string", '/x(abcd)y/.exec("xabcdy")§Q[1]'], replaced: ["string", '"xbcd".replace("x", "a")'], padded: ["string", '"abcd".padEnd(6, "*")'],
    boxedString: ["boxed", 'new String("abcd")'],
    stringWalk: ["walk", '"abcd"[Symbol.iterator]()'], ropeWalk: ["walk", '(("abcdefgh" + one) + "ij")[Symbol.iterator]()'], generatorWalk: ["walk", "(function* () { yield 1; yield 2; })()"], matches: ["walk", '"abab".matchAll(/a/g)'], segments: ["walk", 'new Intl.Segmenter("en").segment("ab")[Symbol.iterator]()'],
    // numbers
    integer: ["number", "7"], zero: ["number", "0"], negative: ["number", "-5"], minusThree: ["number", "-3"], largest32: ["number", "2147483647"], least32: ["number", "-2147483648"], fraction: ["number", "2.5"], notANumber: ["number", "NaN"], minusZero: ["number", "-0"], infinite: ["number", "Infinity"],
    beyond53: ["number", "9007199254740993"], beyond32: ["number", "4294967296"], beyond31: ["number", "2147483648"], below31: ["number", "-2147483649"], largestSafe: ["number", "9007199254740991"], near63: ["number", "9223372036854775807"], least: ["number", "5e-324"], computedInteger: ["number", "one + 6"], computedFraction: ["number", "one / 4"], computedNaN: ["number", "0 / (one - 1)"], computedMinusZero: ["number", "-0 * one"],
    nanOfBytes: ["number", "new Float64Array(new BigUint64Array([0xfffe000000000001n]).buffer)[0]"], parsedNumber: ["number", 'JSON.parse("12.5")§U'], lengthOf: ["number", '"abc".length'], boxedNumber: ["boxed", "new Number(7)"],
    // bigints, booleans, nothing, symbols
    big: ["bigint", "10n"], bigZero: ["bigint", "0n"], bigNegative: ["bigint", "-3n"], bigWide: ["bigint", "2n ** 64n"], bigComputed: ["bigint", "BigInt(one)"],
    yes: ["boolean", "true"], no: ["boolean", "false"], computedYes: ["boolean", "one === 1"], boxedNo: ["boxed", "new Boolean(false)"],
    nothing: ["null", "null"], missing: ["undefined", "undefined"], missingMember: ["undefined", "({}§M).absent"], hole: ["undefined", "[,][0]"],
    symbol: ["symbol", 'Symbol("s")'], registered: ["symbol", 'Symbol.for("s")'], wellKnown: ["symbol", "Symbol.iterator"],
    // promises and thenables
    resolved: ["promise", "Promise.resolve(1)"], resolvedText: ["promise", 'Promise.resolve("abcd")'], rejected: ["promise", 'Promise.reject(new Error("no"))'], pending: ["promise", "new Promise(() => {})"], made: ["promise", "new Promise(r => r(2.5))"], asyncCall: ["promise", "(async () => 1)()"], asyncThrew: ["promise", '(async () => { throw new TypeError("t"); })()'],
    chained: ["promise", "Promise.resolve(0).then(x => x + 1)"], all: ["promise", "Promise.all([1, 2])"], subclassed: ["promise", "new (class Mine extends Promise§P {})(r => r(1))"], ofNative: ["promise", 'new Response("abcd").text()'], withResolvers: ["promise", "(() => { const w = Promise.withResolvers(); w.resolve(1); return w.promise; })()"],
    thenable: ["thenable", "({ then(r§O) { r(1); } })"], thenableRejects: ["thenable", '({ then(_§O, j§J) { j(new Error("no")); } })'], thenableThrows: ["thenable", '({ then(r§O) { throw new RangeError("r"); } })'], thenNotCallable: ["thenable", "({ then: 1 })"], thenableClass: ["thenable", "new (class T { then(r§O) { r(1); } })()"],
    // functions
    plain: ["function", "(function plain(a§A, b§A) { return [a, b]; })"], declared: ["function", "declared"], arrow: ["function", "((a§A) => a)"], closure: ["function", "((k§N) => (a§A) => [k, a])(one)"], closureOnce: ["function", "madeOnce"], closuresInARing: ["function", '(() => { const f = (a§A)§A => (a > 0 ? g(a - 1) : "end"), g = (a§A)§A => f(a); return f; })()'], closureOverItsHolder: ["function", "(() => { const o = { k: one, m: (a§A)§A => [o.k, a] }; return o.m; })()"], closureOverAChange: ["function", "(() => { let k = 0; const f = (a§A) => [k, a]; k = one; return f; })()"], bound: ["function", '(function (§Ya§A) { return [this.k, a]; }).bind({ k: "bound" })'], boundNative: ["function", "Math.max.bind(null, 5)"],
    asyncFunction: ["function", "(async function (a§A) { return a; })"], asyncArrow: ["function", "(async (a§A) => a)"], generatorFunction: ["function", "(function* (a§A) { yield a; yield 2; })"], asyncGenerator: ["function", "(async function* (a§A) { yield a; })"], classValue: ["function", "(class P { §Fa constructor(a§A) { this.a = a; } })"], classDeclared: ["function", "Declared"], classDerived: ["function", "(class Q extends Declared { §Fq constructor(a§A) { super(a); this.q = 1; } })"],
    native: ["function", "Math.max"], nativeString: ["function", "String"], nativeParse: ["function", "parseInt"], hostFunction: ["function", "URL.canParse"], hostClone: ["function", "structuredClone"], method: ["function", '({ k: "o", m(a§A) { return [this?.k, a]; } }).m'], proxied: ["function", "new Proxy((a§A) => a, {})"], withMembers: ["function", "Object.assign((a§A) => a, { a: 1, length2: 2 })"],
    // dates, patterns, errors
    date: ["date", "new Date(0)"], dateInvalid: ["date", "new Date(NaN)"], dateComputed: ["date", "new Date(one * 86400000)"],
    pattern: ["pattern", "/a/g"], patternMade: ["pattern", 'new RegExp("b", "y")'], patternGroups: ["pattern", "/(?<g>a)(b)?/"],
    error: ["error", 'new Error("e")'], typeError: ["error", 'new TypeError("t")'], rangeError: ["error", 'new RangeError("r")'], aggregate: ["error", 'new AggregateError([1], "a")'], errorSubclass: ["error", 'new (class Mine extends Error { extra = 1; })("m")'], errorWithCode: ["error", 'Object.assign(new Error("c"), { code: "E" })'], errorWithCause: ["error", 'new Error("w", { cause: 1 })'],
    errorOfEngine: ["error", "(() => { try { (null§Z).x; } catch (e) { return e§E; } return new Error(); })()"], errorOfHost: ["error", '(() => { try { require("node:fs").readFileSync("/nonexistent/x"); } catch (e) { return e§E; } return new Error(); })()'], domException: ["error", 'new DOMException("d", "AbortError")'],
  };
  const uses: Record<string, string> = {
    // arithmetic
    plusOne: "return v + 1;", onePlus: "return 1 + v;", twice: "return v + v;", minusOne: "return v - 1;", timesTwo: "return v * 2;", halved: "return v / 2;", remainder: "return v % 3;", squared: "return v ** 2;", negated: "return -v;", toNumber: "return +v;", orZero: "return v | 0;", shiftedZero: "return v >>> 0;", shifted: "return v << 1;", inverted: "return ~v;", masked: "return v & 3;",
    increment: "let x = v; x++; return x;", addAssign: "let x = v; x += v; x += 1; return x;", plusText: 'return v + "x";', textPlus: 'return "x" + v;', plusBig: "return v + 1n;", timesBig: "return v * 2n;", sumInLoop: "let s = 0; for (let i = 0; i < 3; i++) s += v; return s;", textInLoop: 'let s = ""; for (let i = 0; i < 3; i++) s += v; return s;',
    accumulate: "let s = v; for (let i = 0; i < 3; i++) s += i; return s;", accumulateText: 'let s = v; for (let i = 0; i < 3; i++) s += "x"; return s;', counterFrom: "let n = 0; for (let i = v; i < 10 && n < 20; i++) n++; return n;", counterTo: "let n = 0; for (let i = 0; i < v && i < 20; i++) n++; return n;", counterBy: "let n = 0; for (let i = 0; i < 10 && n < 20; i += v) n++; return n;", decrement: "let x = v, n = 0; while (x-- > 0 && n < 20) n++; return [x, n];",
    inverse: "return 1 / v;", round: "return Math.round(v);", trunc: "return Math.trunc(v);", sign: "return Math.sign(v);", shiftedByZero: "return v >> 0;", plusHalf: "return v + 0.5;", timesItself: "return v * v;", belowZero: "return v < 0;", isZero: "return v === 0;", plusOneTwice: "return v + 1 + 1;", minusItself: "return v - v;", asIndex: 'return "abcdefgh"[v];', asCount: 'return "ab".repeat(v).length;', asLength: "return new Array(v).length;",
    abs: "return Math.abs(v);", floor: "return Math.floor(v);", max: "return Math.max(v, 1);", imul: "return Math.imul(v, 3);", sqrt: "return Math.sqrt(v);", number: "return Number(v);", parseInt: "return parseInt(v);", parseFloat: "return parseFloat(v);", bigInt: "return BigInt(v);", asIntN: "return BigInt.asIntN(8, v);", isInteger: "return Number.isInteger(v);", isSafe: "return Number.isSafeInteger(v);", isNaN: "return isNaN(v);", numberIsNaN: "return Number.isNaN(v);", isMinusZero: "return Object.is(v, -0);", isNaNByIs: "return Object.is(v, NaN);",
    // with a second value that is of the same two kinds
    sumOfTwo: "const w = other(); return v + w;", differenceOfTwo: "const w = other(); return v - w;", productOfTwo: "const w = other(); return v * w;", quotientOfTwo: "const w = other(); return v / w;", remainderOfTwo: "const w = other(); return v % w;", powerOfTwo: "const w = other(); return v ** w;", andOfTwo: "const w = other(); return v & w;", shiftOfTwo: "const w = other(); return v << w;", sumOfThree: "const w = other(); return v + w + v;",
    lessOfTwo: "const w = other(); return v < w;", atMostOfTwo: "const w = other(); return v <= w;", looseOfTwo: "const w = other(); return v == w;", strictOfTwo: "const w = other(); return v === w;", differOfTwo: "const w = other(); return v != w;", sameOfTwo: "const w = other(); return Object.is(v, w);", templateOfTwo: "const w = other(); return `${v}${w}`;", elseOfTwo: "const w = other(); return v ?? w;", orOfTwo: "const w = other(); return v || w;", andThenOfTwo: "const w = other(); return v && w;",
    maxOfTwo: "const w = other(); return Math.max(v, w);", callOfTwo: "const w = other(); return v(w);", instanceOfTwo: "const w = other(); return v instanceof w;", inOfTwo: "const w = other(); return v in w;", memberOfTwo: "const w = other(); return typeof w[v];", pickOfTwo: "const w = other(); const x = one === 1 ? v : w; return typeof x === typeof v;", swapOfTwo: "let w = other(), x = v; for (let i = 0; i < 3; i++) [x, w] = [w, x]; return [typeof x, typeof w];",
    // many locals that change kind from turn to turn
    rotateFour: "const w = other(); let a = v, b = w, c = v, d = w, n = 0; for (let i = 0; i < 5; i++) { if (i & 1) [a, b] = [b, a]; else { c = d; d = a; } n += typeof a === typeof c ? 1 : 2; } return [a, b, c, d, n];",
    rotateKinds: 'let a = v, b = 1, c = 2.5, d = "x", e = null; for (let i = 0; i < 7; i++) { const t = a; a = b; b = c; c = d; d = e; e = t; } return [a, b, c, d, e];',
    nestedTurns: "const w = other(); let a = v, b = w, n = 0; for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) { const t = a; a = j === i ? b : a; b = t; n++; } } return [a, b, n];",
    byTurn: 'let a = v, b = v, c = v; for (let i = 0; i < 8; i++) switch (i % 4) { case 0: a = i; break; case 1: b = i + 0.5; break; case 2: c = "t" + i; break; default: [a, b, c] = [v, a, b]; } return [a, b, c];',
    keptAcrossCalls: "const w = other(); let a = v, b = w, r = []; for (let i = 0; i < 3; i++) { r.push(show(a)); const t = a; a = b; b = t; } return [r.length, a, b];",
    keptAcrossThrows: "const w = other(); let a = v, b = w, n = 0; for (let i = 0; i < 4; i++) { try { if (i & 1) thrower(a); [a, b] = [b, a]; } catch (e) { n++; b = e; } } return [a, b, n];",
    twelveLocals: "const w = other(); let a = v, b = w, c = 1, d = 2.5, e = v, f = w, g = 3, h = 4.5, i = v, j = w, k = 5, l = 6.5; for (let t = 0; t < 3; t++) { [a, b, c, d, e, f, g, h, i, j, k, l] = [l, a, b, c, d, e, f, g, h, i, j, k]; } return [a, b, c, d, e, f, g, h, i, j, k, l];",
    swapInSomeTurns: "const w = other(); let a = v, b = w; for (let i = 0; i < 5; i++) if (i & 1) { const t = a; a = b; b = t; } return [a, b];",
    lastBeforeChange: "let a = v, last, i = 0; do { last = a; a = other(); } while (i++ < 3); return [last, a];",
    rotateThreeAndLeave: "const w = other(); let a = v, b = w, c = 1; for (let i = 0; i < 9; i++) { [a, b, c] = [b, c, a]; if (i === 4) break; } return [a, b, c];",
    crossed: "const w = other(); const first = one === 1; const x = first ? v : w, y = first ? w : v; return [x, y];",
    crossedInLoop: "const w = other(); let x = v, y = w; for (let i = 0; i < 4; i++) { const odd = (i & 1) === 1; const s = odd ? x : y, t = odd ? y : x; x = t; y = s; } return [x, y];",
    continuedAndLeft: "const w = other(); let a = v, b = w, n = 0; for (let i = 0; i < 9; i++) { if (i % 3 === 0) { a = b; continue; } if (i === 7) { b = a; break; } [a, b] = [b, a]; n++; } return [a, b, n];",
    twoLoopsInARow: "const w = other(); let a = v, b = w; for (let i = 0; i < 3; i++) [a, b] = [b, a]; let c = a; for (let i = 0; i < 2; i++) [b, c] = [c, b]; return [a, b, c];",
    usedBehindTheLoop: "const w = other(); let a = v, before = w; for (let i = 0; i < 3; i++) { before = a; a = i === 1 ? w : v; } return [before, a, typeof before === typeof a];",
    whileWithTwoExits: "const w = other(); let a = v, b = w, i = 0; while (true) { if (i === 2 && typeof a === typeof b) return [a, b, i]; if (i === 5) break; const t = a; a = b; b = t; i++; } return [b, a, i];",
    chainOfCopies: "const w = other(); let a = v, b = w, c = v, d = w; for (let i = 0; i < 3; i++) { d = c; c = b; b = a; a = d; } return [a, b, c, d];",
    // through calls
    tenArguments: 'const w = other(); return tenOf(v, w, 1, 2.5, v, w, "x", null, v, w);', tenArgumentsTwice: 'const w = other(); return [tenOf(v, w, 1, 2.5, v, w, "x", null, v, w), tenOf(w, v, 2.5, 1, w, v, null, "x", w, v)];', fewerArguments: "return tenOf(v);", moreArguments: "const w = other(); return twoOf(v, w, v, w);", defaulted: "return defaultsOf(undefined, v);", defaultedByIt: "return defaultsOf(v);", restOf: "const w = other(); return restOf(v, w, v);", argumentsOf: "const w = other(); return argumentsOf(v, w);",
    tailTurns: "return tailOf(5, v);", tailSwaps: "return tailSwap(5, v, other());", deepReturn: "return deepOf(4, v);", spreadArguments: "const w = other(); return tenOf(...[v, w], ...[w, v]);", applyArguments: "const w = other(); return tenOf.apply(null, [v, w, v]);", callWithThis: "const w = other(); return thisOf.call(v, w);", methodOfTwo: "const w = other(); const holder = { held: v, read: readOf }; return holder.read(w);",
    // comparison
    sameAsItself: "return v === v;", differsFromItself: "return v !== v;", looseSeven: "return v == 7;", strictSeven: "return v === 7;", strictText: 'return v === "abcd";', looseText: 'return v == "7";', lessThanFive: "return v < 5;", atLeastText: 'return v >= "b";', lessThanItself: "return v < v;", atMostItself: "return v <= v;", isNothing: "return v == null;", isMissing: "return v === undefined;", isNull: "return v === null;", looseBig: "return v == 10n;", lessBig: "return v < 10n;", looseTrue: "return v == true;", strictTrue: "return v === true;",
    switchOn: 'switch (v) { case 7: return "seven"; case "abcd": return "text"; case null: return "null"; case true: return "true"; case 10n: return "big"; case undefined: return "undefined"; default: return "other"; }', ifChain: 'if (v === "abcd") return 1; if (v === "a") return 2; if (v === 7) return 3; if (v === null) return 4; if (v === 2.5) return 5; return 0;', textChain: 'return v === "abcd" || v === "a" || v === "123" || v === "";', includes: 'return [7, "abcd", null, NaN, 10n, true].includes(v);', indexOf: 'return [7, "abcd", null, NaN, 10n, true].indexOf(v);', setHas: "const s = new Set([v]); return [s.has(v), s.size];", mapGet: 'const m = new Map([[v, 1], ["abcd", 2], [7, 3], [0, 4]]); return [m.get(v), m.size];', sorted: 'return [v, 3, "b", v].sort().length;',
    // typeof and other tests of the kind
    typeOf: "return typeof v;", byKind: 'if (typeof v === "string") return v.length; if (typeof v === "number") return v + 1; if (typeof v === "function") return v.length; if (typeof v === "bigint") return v + 1n; if (typeof v === "boolean") return !v; if (typeof v === "symbol") return v.description; if (typeof v === "undefined") return "u"; return v === null ? "n" : Object.keys(v).length;',
    byKindSwitch: 'switch (typeof v) { case "string": return v.charCodeAt(0); case "number": return v * 2; case "function": return v.name; case "bigint": return v * 2n; case "object": return v && v.constructor.name; default: return String(v); }', isError: "return v instanceof Error;", isPromise: "return v instanceof Promise;", isFunction: "return v instanceof Function;", isDate: "return v instanceof Date;", isPattern: "return v instanceof RegExp;", isObject: "return v instanceof Object;", isArray: "return Array.isArray(v);", errorIsError: "return Error.isError(v);",
    tagText: "return Object.prototype.toString.call(v);", constructorName: "return v?.constructor?.name;", not: "return !v;", truth: "return v ? 1 : 0;", orElse: 'return v ?? "d";', or: 'return v || "d";', and: "return v && 1;", whileTruthy: "let n = 0, x = v; while (x && n < 3) n++; return n;", objectOf: "return typeof Object(v);", objectIsSame: "return Object(v) === v;",
    // a read that holds for one kind alone, behind its test, in a loop that it does not change in
    lengthInLoop: 'let s = 0; for (let i = 0; i < 5; i++) if (typeof v === "string") s += v.length; return s;', charInLoop: 'let s = 0; for (let i = 0; i < 5; i++) if (typeof v === "string") s += v.charCodeAt(0); else s--; return s;', numberInLoop: 'let s = 0; for (let i = 0; i < 5; i++) if (typeof v === "number") s += v; else s--; return s;', bigInLoop: 'let s = 0n; for (let i = 0; i < 5; i++) if (typeof v === "bigint") s += v; return s;',
    callInLoop2: 'let s = 0; for (let i = 0; i < 5; i++) if (typeof v === "function") s += v.length; else s--; return s;', nameInLoop: 'let t = ""; for (let i = 0; i < 3; i++) if (typeof v === "function") t += v.name; return t;', messageInLoop: 'let t = ""; for (let i = 0; i < 3; i++) if (v instanceof Error) t += v.message; else t += "-"; return t;', timeInLoop: "let s = 0; for (let i = 0; i < 3; i++) if (v instanceof Date) s += v.getTime(); else s--; return s;",
    sourceInLoop: 'let t = ""; for (let i = 0; i < 3; i++) if (v instanceof RegExp) t += v.source + v.lastIndex; return t;', descriptionInLoop: 'let t = ""; for (let i = 0; i < 3; i++) if (typeof v === "symbol") t += v.description; return t;', memberInLoop: 'let t = ""; for (let i = 0; i < 3; i++) if (v != null) t += typeof v.constructor; else t += "-"; return t;', truthInLoop: "let n = 0; for (let i = 0; i < 5; i++) if (v) n++; return n;",
    rareLengthInLoop: 'let s = 0; for (let i = 0; i < 9; i++) if (i === 7 && typeof v === "string") s += v.length; return s;', rareCallInLoop: 'let r; for (let i = 0; i < 9; i++) if (i === 7 && typeof v === "function") r = v(i); return r;', rareMessageInLoop: "let r; for (let i = 0; i < 9; i++) if (i === 7 && v instanceof Error) r = v.message; return r;", lengthBehindLoop: 'let n = 0; for (let i = 0; i < 3; i++) n += i; return typeof v === "string" ? v.length + n : n;',
    walkIfText: 'let s = 0; if (typeof v === "string") for (let i = 0; i < v.length; i++) s += v.charCodeAt(i); else s = -1; return s;', keptPart: 'let kept = null; for (let i = 0; i < 4; i++) if (typeof v === "string" && i === 2) kept = v.slice(1); return kept;', keptSum: 'let kept; for (let i = 0; i < 4; i++) if (typeof v === "number") kept = v + i; return kept;', keptClosure: "let kept = null; for (let i = 0; i < 4; i++) if (i === 2) kept = () => v; return kept() === v || v !== v;",
    // text
    inTemplate: "return `<${v}>`;", string: "return String(v);", emptyPlus: 'return "" + v;', joinOne: "return [v].join();", joinTwo: 'return [v, v].join("-");', json: "return JSON.stringify(v);", jsonMember: "return JSON.stringify({ v: v });", jsonList: "return JSON.stringify([v]);", toStringCall: 'return typeof v.toString();', valueOf: "return v.valueOf() === v;", concat: 'return "x".concat(v);', asKey: "const o = {}; o[v] = 1; return Reflect.ownKeys(o).length;", lookup: "return ({ abcd: 1, 7: 2, a: 3, null: 4, undefined: 5, true: 6, NaN: 7 })[v];", lookupList: 'return ["x", "y", "z"][v];', inRecord: "return v in { abcd: 1, 7: 2 };",
    // members of it
    length: "return v.length;", first: "return v[0];", last: "return v[v.length - 1];", name: "return v.name;", message: "return v.message;", a: "return v.a;", then: "return typeof v.then;", description: "return v.description;", source: "return v.source;", lastIndex: "return v.lastIndex;", stack: "return typeof v.stack;", prototype: "return typeof v.prototype;", optionalLength: "return v?.length;", optionalAt: "return v?.at?.(-1);", cause: "return v.cause;", code: "return v.code;",
    charCodeAt: "return v.charCodeAt(0);", charCodeLoop: "let s = 0; for (let i = 0; i < v.length; i++) s += v.charCodeAt(i); return s;", readBackwards: 'let s = ""; for (let i = v.length - 1; i >= 0; i--) s += v[i]; return s;', slice: "return v.slice(1);", substring: "return v.substring(1, 3);", toFixed: "return v.toFixed(1);", toStringRadix: "return v.toString(16);", getTime: "return v.getTime();", toISO: "return v.toISOString();", test: 'return v.test("ab");', exec: 'return v.exec("ab");', indexOfText: 'return v.indexOf("b");', upper: "return v.toUpperCase();", padStart: "return v.padStart(6);", split: 'return v.split("");', startsWith: 'return v.startsWith("a");', replace: 'return v.replace("a", "z");', trim: "return v.trim();", repeat: "return v.repeat(2);", codePointAt: "return v.codePointAt(1);", localeCompare: 'return v.localeCompare("abcd");', matchText: "return v.match(/b/);",
    hasLength: 'return "length" in v;', keys: "return Object.keys(v);", ownNames: "return Object.getOwnPropertyNames(v).length;", store: "v.x = 1; return v.x;", storeLength: "v.length = 1; return v.length;", forIn: "let n = 0; for (const k in v) n++; return n;", spread: "return [...v];", spreadRecord: "return { ...v };", forOf: "const r = []; for (const each of v) r.push(each); return r;", countForOf: "let n = 0; for (const each of v) n++; return n;", splitWalk: 'const r = []; for (const part of v.split("b")) r.push(part); return r;', splitSpread: 'return [...v.split("")];', splitCount: 'let n = 0; for (const part of v.split("")) n++; return n;', walkTwice: "const r = []; for (const each of v) r.push(each); for (const each of v) r.push(each); return r;", walkAndLeave: "for (const each of v) return each;", spreadTwice: "return [...v, ...v];", spreadIntoCall: "return Math.max(...v);", newSet: "return new Set(v).size;", takeLength: "const { length } = v; return length;", takeFirst: "const [a] = v; return a;", takeMessage: "const { message, name } = v; return [message, name];", prototypeOf: "return Object.getPrototypeOf(v) === Object.getPrototypeOf(Object(v));", hasOwn: 'return Object.hasOwn(v, "length");', hasOwnMethod: 'return v.hasOwnProperty("length");', arrayFrom: "return Array.from(v);", freeze: "return Object.isFrozen(Object.freeze(v));", weak: "return new WeakSet([v]).has(v);", clone: "return structuredClone(v);",
    // calls
    call0: "return v();", call2: "return v(1, 2);", construct: "return new v(1);", dotCall: "return v.call(null, 1);", dotApply: "return v.apply(null, [1, 2]);", optionalCall: "return v?.(1);", bindCall: "return v.bind(null, 1)();", mapWith: "return [1, 2].map(v);", reflectApply: "return Reflect.apply(v, undefined, [1]);", reflectConstruct: "return Reflect.construct(v, [1]);", tagged: "return v`a`;", callIfFunction: 'return typeof v === "function" ? v(1) : v;', callSpread: "return v(...[1, 2]);", asMethod: "const o = { k: 1, v: v }; return o.v(1);", asCallback: 'return "ab".replace(/a/, v);', asGetter: 'return Object.defineProperty({}, "g", { get: v }).g;', asValueOf: "return +{ valueOf: v };", sortWith: "return [2, 1].sort(v);", instanceOfIt: "return ({}) instanceof v;", extendsIt: "return typeof class extends v {};", argumentOfNative: "return Math.max(v, v);", argumentOfHost: "return Buffer.byteLength(v);",
    walkCall: "const r = []; for (const each of v(1)) r.push(each); return r;", spreadCall: "return [...v(1)];", callTwice: "return [v(1), v(2)];", callResultMember: "return v(1)?.length;", callInLoop: "let r; for (let i = 0; i < 3; i++) r = v(i); return r;", callWithItself: "return typeof v(v);", newMember: "return new v(1).a;", keepAndCall: "const kept = { f: v }; return kept.f === v && kept.f(1);",
    filterWith: "return [0, 1, 2].filter(v);", findWith: "return [0, 1, 2].find(v);", findIndexWith: "return [0, 1, 2].findIndex(v);", someWith: "return [0, 1].some(v);", everyWith: "return [1, 2].every(v);", reduceWith: "return [1, 2, 3].reduce(v);", reduceFrom: "return [1, 2, 3].reduce(v, 10);", forEachWith: "return [1, 2].forEach(v);", flatMapWith: "return [1, 2].flatMap(v);", fromWith: "return Array.from({ length: 2 }, v);", fromListWith: "return Array.from([1, 2], v);", toSortedWith: "return [3, 1, 2].toSorted(v);",
    mapForEachWith: 'return new Map([["a", 1]]).forEach(v);', setForEachWith: "return new Set([1]).forEach(v);", parseWith: 'return JSON.parse("[1]", v);', chainWith: "return [1, 2, 3].map(v).filter(v).length;", mapThenJoin: 'return [1, 2].map(v).join("-");', typedMapWith: "return new Uint8Array([1, 2]).map(v);", replaceAllWith: 'return "aba".replaceAll("a", v);', entriesMapWith: "return Object.entries({ a: 1 }).map(v);", groupWith: "return Object.keys(Object.groupBy([1, 2], v));",
    // a method of a built-in borrowed for it
    borrowedMap: "return Array.prototype.map.call(v, each => each);", borrowedWhole: "const seen = []; Array.prototype.forEach.call(v, (each, index, whole) => seen.push(typeof whole, whole[index], whole === v)); return seen;", borrowedFilter: "return Array.prototype.filter.call(v, (each, index, whole) => whole.length > index);", borrowedReduce: 'return Array.prototype.reduce.call(v, (sum, each, index, whole) => sum + typeof whole + whole.length, "");', borrowedFind: "return Array.prototype.find.call(v, (each, index, whole) => typeof whole === \"object\");", borrowedSome: "return Array.prototype.some.call(v, (each, index, whole) => whole[index] === each);",
    borrowedIndexOf: 'return Array.prototype.indexOf.call(v, "b");', borrowedJoin: 'return Array.prototype.join.call(v, "-");', borrowedSlice: "return Array.prototype.slice.call(v, 1);", borrowedAt: "return Array.prototype.at.call(v, 0);", borrowedIncludes: 'return Array.prototype.includes.call(v, "a");', borrowedKeys: "return [...Array.prototype.keys.call(v)];", borrowedEntries: "return [...Array.prototype.entries.call(v)];", borrowedConcat: "const r = Array.prototype.concat.call(v, 1); return [r.length, typeof r[0]];",
    borrowedValueOf: "const r = Object.prototype.valueOf.call(v); return [typeof r, r === v];", borrowedHasOwn: 'return Object.prototype.hasOwnProperty.call(v, "length");', borrowedIsEnumerable: "return Object.prototype.propertyIsEnumerable.call(v, 0);", borrowedIsPrototypeOf: "return Object.prototype.isPrototypeOf.call(v, v);", borrowedToLocale: "return typeof Object.prototype.toLocaleString.call(v);",
    borrowedTextSlice: "return String.prototype.slice.call(v, 1);", borrowedTextAt: "return String.prototype.at.call(v, 0);", borrowedTextConcat: 'return String.prototype.concat.call(v, "x");', borrowedTrim: "return String.prototype.trim.call(v);", borrowedCharCode: "return String.prototype.charCodeAt.call(v, 0);", borrowedTextValueOf: "return String.prototype.valueOf.call(v);", borrowedToFixed: "return Number.prototype.toFixed.call(v, 1);", borrowedNumberValueOf: "return Number.prototype.valueOf.call(v);", borrowedBooleanValueOf: "return Boolean.prototype.valueOf.call(v);", borrowedSymbolText: "return Symbol.prototype.toString.call(v);", borrowedBigText: "return BigInt.prototype.toString.call(v);",
    borrowedCall: "return Function.prototype.call.call(v, null, 1);", borrowedApply: "return Function.prototype.apply.call(v, null, [1]);", borrowedBind: "return Function.prototype.bind.call(v, null, 1)();", borrowedTime: "return Date.prototype.getTime.call(v);", borrowedTest: 'return RegExp.prototype.test.call(v, "a");', borrowedErrorText: "return Error.prototype.toString.call(v);", borrowedThen: "return typeof Promise.prototype.then.call(v, each => each);",
    reflectedMap: "return Reflect.apply(Array.prototype.map, v, [(each, index, whole) => typeof whole]);", reflectedValueOf: "return typeof Reflect.apply(Object.prototype.valueOf, v, []);", reflectedSlice: "return Reflect.apply(String.prototype.slice, v, [1]);", calledMap: "return Function.prototype.call.call(Array.prototype.map, v, (each, index, whole) => typeof whole);", boundMap: "return Array.prototype.map.bind(v)((each, index, whole) => typeof whole);", keptMethod: "const map = Array.prototype.map; return map.call(v, (each, index, whole) => whole[index]);",
    // thrown and caught
    throwCatch: "try { throw v; } catch (e) { return e; }", throwCatchSame: "try { throw v; } catch (e) { return e === v || e !== e; }", throwCatchMessage: "try { throw v; } catch (e) { return e.message; }", throwCatchPattern: "try { throw v; } catch ({ message, name }) { return [message, name]; }", throwCatchKind: 'try { throw v; } catch (e) { return e instanceof Error ? e.name : typeof e; }', throwFromHelper: "try { thrower(v); } catch (e) { return e; }", throwFinally: 'let n = 0; try { try { throw v; } finally { n++; } } catch (e) { return [n, e]; }', rethrow: "try { try { throw v; } catch (e) { throw e; } } catch (e) { return e; }", throwOut: "throw v;", asCause: 'return new Error("w", { cause: v }).cause;', asMessage: "return new Error(v).message;", generatorThrow: "const g = (function* () { try { yield 1; } catch (e) { yield e; } })(); g.next(); return g.throw(v).value;", generatorReturn: "const g = (function* () { yield 1; })(); g.next(); return g.return(v).value;", yielded: "return [...(function* () { yield v; yield v; })()];",
    changedBeforeThrow: "let a = v, b = 0; try { b = 1; a = other(); thrower(a); b = 2; } catch (e) { return [a, b, e === a || e !== e]; }", finallySeesChange: "let a = v, seen; try { a = other(); thrower(1); } catch (e) { a = [a]; } finally { seen = a; } return seen;", returnThroughFinally: "let a = v; try { return a; } finally { a = other(); }", finallyOverrides: 'try { throw v; } finally { return "finally"; }',
    leaveThroughFinally: "let a = v, n = 0; for (let i = 0; i < 4; i++) { try { if (i === 2) break; a = other(); } finally { n++; } } return [a, n];", continueThroughFinally: "let a = v, n = 0; for (let i = 0; i < 4; i++) { try { if (i & 1) continue; a = other(); } finally { n++; } } return [a, n];", thrownInCatch: "let a = v; try { try { thrower(a); } catch (e) { a = other(); thrower([e, a]); } } catch (e) { return [a, e]; }", thrownInFinally: "let a = v; try { try { thrower(1); } finally { a = other(); thrower(a); } } catch (e) { return [a, e === a || e !== e]; }",
    thrownFromDeep: "const deep = (n§N, x§A)§A => (n ? deep(n - 1, x) : thrower(x)); let a = v, b = other(); try { deep(3, a); } catch (e) { return [a, b, e === a || e !== e]; }", thrownInEachTurn: "let a = v, b = other(), n = 0; for (let i = 0; i < 4; i++) { try { thrower(i & 1 ? a : b); } catch (e) { [a, b] = [b, e]; n++; } } return [a, b, n];", thrownByARead: "let a = v, b = other(); try { return [a.x.y, b]; } catch (e) { return [a, b, e instanceof TypeError]; }", thrownByACall: "let a = v, b = other(); try { return [a(b), 1]; } catch (e) { return [a, b, e instanceof TypeError]; }",
    walkLeftByThrow: "let a = v, closed = 0; const walk = (function* () { try { yield 1; yield 2; } finally { closed++; } })(); try { for (const each of walk) thrower(a); } catch (e) { return [closed, e === a || e !== e]; }", patternThrows: "let a = v; try { const { x: { y } } = a; return y; } catch (e) { return [a, e instanceof TypeError]; }", spreadThrows: "let a = v, b = other(); try { return [...a, b].length; } catch (e) { return [a, b, e instanceof TypeError]; }",
  };
  const waits: Record<string, string> = {
    await: "return await v;", awaitTwice: "const a = await v; const b = await v; return [a, b];", awaitTry: 'try { return await v; } catch (e) { return ["caught", e]; }', awaitFinally: "let n = 0; try { return await v; } finally { n++; } ", awaitPlus: "return (await v) + 1;", awaitTemplate: "return `<${await v}>`;", awaitTypeOf: "return typeof (await v);", awaitLength: "return (await v)?.length;", awaitCall: "return (await v)?.(1);", awaitTruth: 'return (await v) ? "yes" : "no";',
    awaitCallOfIt: "return await v(1);", awaitCallTwice: "return [await v(1), await v(2)];", awaitCallTry: 'try { return await v(1); } catch (e) { return ["caught", e instanceof Error ? e.name : e]; }', forAwaitCall: "const l = []; for await (const x of v(1)) l.push(x); return l;", thenOfCall: "return v(1).then(x => [x]);",
    keptAcrossAwait: "const a = v, b = other(); await null; return [a, b];", swappedAcrossAwaits: "let a = v, b = other(); for (let i = 0; i < 3; i++) { await null; [a, b] = [b, a]; } return [a, b];", changedBetweenAwaits: "let a = v; await null; const b = a; a = other(); await null; return [a, b];", thrownBehindAwait: "let a = v, b = other(); try { await null; thrower(a); } catch (e) { return [a, b, e === a || e !== e]; }", awaitInFinallyKeeps: "let a = v; try { thrower(1); } catch (e) { a = [a]; } finally { await null; } return a;", sixAcrossAwait: "let a = v, b = other(), c = 1, d = 2.5, e = v, f = other(); await null; [a, b, c, d, e, f] = [f, a, b, c, d, e]; await null; return [a, b, c, d, e, f];", yieldedBetween: "const g = (function* (x§A, y§A) { yield x; yield y; yield x; })(v, other()); return [...g];", asyncYieldedBetween: "const r = []; for await (const each of (async function* (x§A, y§A) { yield x; await null; yield y; })(typeof v, other())) r.push(each); return r;",
    returnIt: "return v;", returnInTry: 'try { return v; } catch (e) { return "caught"; }', thenOf: 'return v.then(x => ["then", x], e => ["failed", e]);', catchOf: 'return v.catch(e => ["caught", e]);', finallyOf: "return v.finally(() => {});", resolve: "return Promise.resolve(v);", resolveSame: "return Promise.resolve(v) === v;", resolveThen: 'return Promise.resolve(v).then(x => ["then", x], e => ["failed", e]);', reject: 'return Promise.reject(v).catch(e => ["caught", e === v || e !== e]);', awaitReject: 'try { await Promise.reject(v); } catch (e) { return ["caught", e === v || e !== e]; }',
    allOf: "return Promise.all([v, 2]);", allSettled: "return Promise.allSettled([v, 2]);", race: "return Promise.race([v]);", any: "return Promise.any([v]);", forAwait: "const l = []; for await (const x of [v, 2]) l.push(x); return l;", newPromise: "return new Promise(r => r(v));", asExecutor: "return new Promise(v);", thenWith: "return Promise.resolve(1).then(v);", catchWith: "return Promise.reject(1).catch(v);", finallyWith: "return Promise.resolve(1).finally(v);", thenReturns: "return Promise.resolve(1).then(() => v);", yieldAwait: "const g = (async function* () { yield v; })(); return (await g.next()).value;", asyncThrow: "throw v;", awaitInLoop: "let t = []; for (let i = 0; i < 2; i++) t.push(await v); return t;", microtask: "return new Promise(r => queueMicrotask(() => r(typeof v)));",
  };
  return { births, uses, waits };
}
// What holds for one kind alone, and the test that tells the kind. A read stands behind the test, in every shape below.
const kinds: Record<string, { test?: string; testAmongObjects?: string; reads: string[] }> = {
  string: { test: 'typeof v === "string"', reads: ["v.length", "v.charCodeAt(0)", "v.slice(1)", "v.toUpperCase()", 'v + "x"', "v[0]", 'v.indexOf("b")', "`<${v}>`", 'v === "abcd"', 'v < "b"', "[...v].length", 'v.split("b").length', "v.at(-1)", "v.codePointAt(1)", "v.trim()", "v.repeat(2)", 'v.startsWith("a")', "parseInt(v)", "Number(v)", "v.substring(1, 3)", "v.padStart(6)", "v.concat(v)", 'v.localeCompare("abcd")', 'v.replace("a", "z")'] },
  number: { test: 'typeof v === "number"', reads: ["v + 1", "v * 2", "v / 2", "v % 3", "-v", "v | 0", "v >>> 0", "v.toFixed(1)", "Math.floor(v)", "v < 5", "v === 7", "String(v)", "`${v}`", "Number.isInteger(v)", "Object.is(v, -0)", "v !== v", "Math.max(v, 1)", "v ** 2", "v.toString(16)", "~v", "v << 1", "isNaN(v)", "Math.sqrt(v)", "v - 1"] },
  bigint: { test: 'typeof v === "bigint"', reads: ["v + 1n", "v * 2n", "-v", "v < 10n", "v === 10n", "v.toString()", "BigInt.asIntN(8, v)", "Number(v)", "`${v}`", "v % 3n", "v ** 2n", "v >> 1n"] },
  boolean: { test: 'typeof v === "boolean"', reads: ["!v", "v ? 1 : 0", "v === true", "String(v)", "Number(v)", "`${v}`", "v.toString()", "v && 1"] },
  null: { test: "v === null", reads: ["v === null", "String(v)", "`${v}`", "typeof v"] },
  undefined: { test: "v === undefined", reads: ["v === undefined", "String(v)", "`${v}`", "typeof v"] },
  symbol: { test: 'typeof v === "symbol"', reads: ["v.description", "v.toString()", "String(v)", "typeof v", "Object(v) instanceof Symbol", "Symbol.keyFor(v)"] },
  promise: { test: "v instanceof Promise", reads: ["typeof v.then", "v.then(() => 1) instanceof Promise", "Promise.resolve(v) === v", "await v", 'await v.then(x => [x], e => ["failed", e])', 'await v.catch(() => "caught")', "await Promise.all([v])", "await v.finally(() => {})", "await Promise.race([v])"] },
  thenable: { testAmongObjects: '"then" in v', reads: ["typeof v.then", "await v", "await Promise.resolve(v)", "Object.keys(v).length"] },
  function: { test: 'typeof v === "function"', reads: ["v.length", "v.name", "typeof v.prototype", "(v§G)(1)", "Reflect.apply(v, undefined, [1, 2])", "Reflect.construct(v, [1])", "(v§G).call(null, 1)", "(v§G).bind(null, 1)()", "[1, 2].map(v§Z)", "new (v§Z)(1)", "await (v§G)(1)"] },
  date: { test: "v instanceof Date", reads: ["v.getTime()", "v.toISOString()", "+v", "v.valueOf()", "v.getUTCDay()", "JSON.stringify(v)", "v < new Date(1)", "v.getUTCFullYear()"] },
  pattern: { test: "v instanceof RegExp", reads: ["v.source", "v.flags", "v.lastIndex", 'v.test("ab")', 'v.exec("ab")?.[0]', '"ab".replace(v, "z")', '"ab".match(v)?.length', "String(v)", "v.global"] },
  error: { test: "v instanceof Error", reads: ["v.message", "v.name", "typeof v.stack", "String(v)", "v instanceof TypeError", "v.cause", "Object.prototype.toString.call(v)"] },
  boxed: { reads: ["v.valueOf()", "typeof v", "v.toString()", "String(v)"] },
  walk: { testAmongObjects: '"next" in v', reads: ["v.next().value", "[...v].length", "v.next().done", "typeof v.next"] },
};
const typeNames: Record<string, string> = { string: "string", number: "number", bigint: "bigint", boolean: "boolean", symbol: "symbol", function: "Function", date: "Date", pattern: "RegExp", error: "Error", promise: "AnyPromise" };
// g tells the first kind; a holds for the first kind alone, b for the second.
const shapes: Record<string, (g: string, a: string, b: string) => string> = {
  ifElse: (g, a, b) => `if (${g}) return ${a}; else return ${b};`,
  conditional: (g, a, b) => `return ${g} ? ${a} : ${b};`,
  negated: (g, a, b) => `if (!(${g})) return ${b}; return ${a};`,
  inLoop: (g, a, b) => `let r; for (let i = 0; i < 4; i++) { if (${g}) r = ${a}; else r = ${b}; } return r;`,
  inOneTurn: (g, a, b) => `let r; for (let i = 0; i < 9; i++) if (i === 7) r = ${g} ? ${a} : ${b}; return r;`,
  aroundLoops: (g, a, b) => `let r; if (${g}) { for (let i = 0; i < 3; i++) r = ${a}; } else { for (let i = 0; i < 3; i++) r = ${b}; } return r;`,
  continued: (g, a, b) => `let r; for (let i = 0; i < 4; i++) { if (!(${g})) { r = ${b}; continue; } r = ${a}; } return r;`,
  oneArm: (g, a, b) => `let r; for (let i = 0; i < 4; i++) if (${g}) r = ${a}; return r;`,
  otherArm: (g, a, b) => `let r; for (let i = 0; i < 4; i++) if (!(${g})) r = ${b}; return r;`,
  inClosure: (g, a, b) => `const read = () => (${g} ? ${a} : ${b}); return read();`,
  twice: (g, a, b) => `const first = ${g} ? ${a} : ${b}; const second = ${g} ? ${a} : ${b}; return [first, second];`,
  testKept: (g, a, b) => `const isFirst = ${g}; return isFirst ? ${a} : ${b};`,
  finallyBetween: (g, a, b) => `let n = 0; try { if (${g}) return ${a}; } finally { n++; } return ${b};`,
  keptInABox: (g, a, b) => `let kept = null; for (let i = 0; i < 4; i++) if (i === 2) kept = { held: ${g} ? ${a} : ${b} }; return kept;`,
};
// Every read of a kind at once, each held in a local of its own until the end: many values of many forms live together, around a loop, across a call and across a throw.
const calm = (reads: string[]) => reads.filter(read => !/§[GZ]|Reflect\.|toISOString|await /.test(read)).slice(0, 12);
function allHeld(fill: (names: string[]) => string, count: number): [string, string, boolean][] {
  const names = Array.from({ length: count }, (_, i) => `r${i}`);
  const declared = names.map(name => name + "§A").join(", ");
  const turned = `for (let i = 0; i < 3; i++) { const t§A = r0; ${names.slice(1).map((name, i) => `r${i} = ${name};`).join(" ")} r${count - 1} = t; }`;
  return [
    ["allHeld", `let ${declared}; ${fill(names)} ${turned} return [${names.join(", ")}];`, false],
    ["allHeldAcrossACall", `let ${declared}; ${fill(names)} const w = show(other()); ${turned} return [${names.join(", ")}, w];`, false],
    ["allHeldAcrossAThrow", `let ${declared}, s; ${fill(names)} try { thrower(r0); } catch (e) { s = e === r0 || e !== e; } return [${names.join(", ")}, s];`, false],
  ];
}
/** The reads behind their tests for a pair of kinds: [name, body, does it wait]. */
function guarded(first: string, second: string, shift: number): [string, string, boolean][] {
  const made: [string, string, boolean][] = [];
  const names = Object.keys(shapes);
  if (first === second) {
    kinds[first].reads.forEach((a, i) => {
      made.push([`read${i}`, `return ${a};`, a.includes("await ")]);
      made.push([`readInLoop${i}`, `let r; for (let i = 0; i < 4; i++) r = ${a}; return r;`, a.includes("await ")]);
    });
    const reads = calm(kinds[first].reads);
    made.push(...allHeld(names => names.map((name, i) => `${name} = ${reads[i]};`).join(" "), reads.length));
    return made;
  }
  const amongObjects = ["thenable", "boxed", "walk"].includes(first) && ["thenable", "boxed", "walk"].includes(second);
  const testOf = (kind: string) => kinds[kind].test ?? (amongObjects ? kinds[kind].testAmongObjects : undefined);
  const [tested, rest] = testOf(first) ? [first, second] : [second, first];
  const g = testOf(tested);
  if (!g) return made;
  const [as, bs] = [kinds[tested].reads, kinds[rest].reads];
  for (let i = 0; i < Math.max(as.length, bs.length); i++) for (let j = 0; j < 4; j++) {
    const shape = names[(i * 4 + j + shift) % names.length], a = as[i % as.length], b = bs[i % bs.length], waits = (a + b).includes("await ");
    if (waits && shape === "inClosure") continue;
    made.push([`${shape}${i}`, shapes[shape](g, a, b), waits]);
  }
  const [calmAs, calmBs] = [calm(as), calm(bs)], held = Math.max(calmAs.length, calmBs.length);
  made.push(...allHeld(names => `if (${g}) { ${names.map((name, i) => `${name} = ${calmAs[i % calmAs.length]};`).join(" ")} } else { ${names.map((name, i) => `${name} = ${calmBs[i % calmBs.length]};`).join(" ")} }`, held));
  // No test at all: the program says which kind it is, and is wrong for the other. A cast does nothing and `!` checks nothing, so the read does what it does in JavaScript.
  const said = (read: string, kind: string) => read.replace(/(?<![\w"])(?<!(?<!\.\.)\.)v\b/g, `(v§<${typeNames[kind]}>)`);
  for (const [kind, reads] of [[tested, as], [rest, bs]] as [string, string[]][]) if (typeNames[kind]) reads.forEach((read, i) => made.push([`said${kind === tested ? "First" : "Second"}${i}`, `return ${said(read, kind)};`, read.includes("await ")]));
  if (tested === "null" || tested === "undefined") bs.forEach((b, i) => {
    made.push([`asserted${i}`, `return ${b.replace(/(?<![\w"])(?<!(?<!\.\.)\.)v\b/g, "v§Q")};`, b.includes("await ")]);
    made.push([`looseTest${i}`, `if (v == null) return "nothing"; return ${b};`, b.includes("await ")]);
    if (b.startsWith("v.")) made.push([`optional${i}`, `return v?.${b.slice(2)};`, false]);
  });
  return made;
}
// What the checker takes whatever the type of v is.
const takenOfAnyType = new Set("allOf allSettled and andThenOfTwo any asCause asValueOf asyncThrow await awaitFinally awaitInLoop awaitReject awaitTruth awaitTry awaitTwice awaitTypeOf clone differOfTwo differsFromItself elseOfTwo errorIsError freeze generatorThrow isArray isMinusZero isMissing isNaNByIs isNothing isNull joinOne joinTwo json jsonList jsonMember looseOfTwo microtask newPromise not number objectIsSame objectOf or orElse orOfTwo ownNames pickOfTwo prototypeOf race reject resolve resolveThen rethrow returnInTry returnIt sameAsItself sameOfTwo setHas sorted strictOfTwo string swapOfTwo tagText throwCatch throwCatchKind throwCatchSame throwFinally throwFromHelper throwOut truth truthInLoop typeOf whileTruthy yieldAwait yielded".split(" "));
// The text of a function is what was written, and under plain Bun what its transpiler printed: which of two texts comes first differs.
const ordersTexts = new Set(["lessOfTwo", "atMostOfTwo"]);
// The first use of each group, and the kinds that the group means something to.
const groups: Record<string, string> = {
  plusOne: "string number bigint boolean null undefined date boxed", sumOfTwo: "all", charCodeAt: "string boxed number bigint date pattern", hasLength: "all", call0: "function", borrowedMap: "all", throwCatch: "all", await: "promise thenable function",
};
// An Error has own properties that hold the place in the source; under plain Bun how many there are differs from run to run, so ownNames is not asked of an error.
const testsTruth = new Set("and andThenOfTwo truth truthInLoop whileTruthy or orOfTwo not awaitTruth".split(" "));
const head = `process.on("unhandledRejection", () => {});
const one = Date.now() > 0 ? 1 : 2;
const madeOnce = ((k§T) => (a§A) => [k, a])("once");
function declared(a§A, b§A) { return [a, b]; }
class Declared { §Fa constructor(a§A) { this.a = a; } }
function thrower(v§A) { throw v; }
function tenOf(a§R, b§R, c§R, d§R, e§R, f§R, g§R, h§R, i§R, j§R) { return [j, i, h, g, f, e, d, c, b, a]; }
function twoOf(a§A, b§A) { return [b, a]; }
function defaultsOf(a§A = 1, b§A = a) { return [a, b]; }
function restOf(a§A, ...rest§D) { return [rest.length, rest[1], a]; }
function argumentsOf(a§R, b§R) { return [arguments.length, arguments[1], arguments[0]]; }
function tailOf(n§N, kept§A)§A { return n ? tailOf(n - 1, n & 1 ? kept : [kept][0]) : kept; }
function tailSwap(n§N, a§A, b§A)§A { return n ? tailSwap(n - 1, b, a) : [a, b]; }
function deepOf(n§N, x§A)§A { return n ? [deepOf(n - 1, x)][0] : x; }
function thisOf(§Yx§A) { return [this, x]; }
function readOf(§Yx§A) { return [this.held, x]; }
async function late(turns§N) { for (let i = 0; i < turns; i++) await null; return "late"; }
async function timed(started§A, limit§N) {
  let turns = 0, settled = false;
  const count = () => { if (!settled && turns < limit) { turns++; Promise.resolve().then(count); } };
  Promise.resolve().then(count);
  try { const answer = await Promise.race([started, late(limit)]); settled = true; return [turns, answer]; } catch (e) { settled = true; return [turns, thrown(e)]; }
}
function show(r§A, depth = 0)§T {
  if (r === null) return "null";
  if (r === undefined) return "undefined";
  if (typeof r === "string" && /=>|function|class |native code|return|yield|constructor\\(/.test(r)) return "string that holds the text of a function";
  if (typeof r === "string") { let t = "string " + r.length + ":"; for (let i = 0; i < r.length && i < 40; i++) t += r.charCodeAt(i).toString(16) + "."; return t; }
  if (typeof r === "number") return Object.is(r, -0) ? "-0" : "number " + r;
  if (typeof r === "bigint") return "big " + r;
  if (typeof r === "boolean") return "boolean " + r;
  if (typeof r === "symbol") return String(r);
  if (typeof r === "function") return "function " + r.name + "/" + r.length;
  if (depth > 3) return "..";
  if (Array.isArray(r)) { let t = "["; for (let i = 0; i < r.length; i++) t += (i ? "," : "") + (i in r ? show(r[i], depth + 1) : "hole"); return t + "]"; }
  if (r instanceof Error) return "error " + r.name + "(" + r.message + ")";
  if (r instanceof Promise) return "promise";
  if (r instanceof Date) return "date " + r.getTime();
  if (r instanceof RegExp) return "pattern " + r.source + "/" + r.flags + "/" + r.lastIndex;
  if (r instanceof String || r instanceof Number || r instanceof Boolean) return "boxed " + show(r.valueOf());
  if (typeof r.next === "function") return "walk";
  let t = "{"; for (const k of Object.keys(r)) t += k + ":" + show(r[k], depth + 1) + ","; return t + "}";
}
function thrown(e§A) { return "threw " + (e instanceof Error ? e.name : show(e)); }
class Holder { §Fh constructor(held§V) { this.held = held; } }
function note(title§T, answers§L) { const seen§L = []; for (const each of answers) if (!seen.includes(each)) seen.push(each); console.log(title + ": " + seen.join(" | ")); }
`;
// A road is how the two kinds get to the one place: u names the use, body is its text, A and B are the births, W says whether the use waits, T is how often the place is visited.
type Form = { f: string; w: string; a: (call: string, limit?: number) => string; typed?: boolean };
const roads: Record<string, (u: string, body: string, A: string, B: string, W: Form, T: number) => string> = {
  handed: (u, body, A, B, W, T) => `${W.f} use_${u}(v§V) { ${body} }
${W.f} attempt_${u}(v§V) { try { return show(${W.a("use_" + u + "(v)")}); } catch (e) { return thrown(e); } }
{ const answers§L = []; for (let n = 0; n < turns; n++) answers.push(${W.w}attempt_${u}(${A})); for (let n = 0; n < 3; n++) answers.push(${W.w}attempt_${u}(${B})); answers.push(${W.w}attempt_${u}(${A})); note("${u}", answers); }
`,
  handedOnce: (u, body, A, B, W, T) => `${W.f} use_${u}(v§V) { ${body} }
${W.f} attempt_${u}(v§V) { try { return show(${W.a("use_" + u + "(v)")}); } catch (e) { return thrown(e); } }
{ const answers§L = []; for (let n = 0; n < turns; n++) answers.push(${W.w}attempt_${u}(${A})); answers.push(${W.w}attempt_${u}(${B})); note("${u}", answers); }
`,
  returned: (u, body, A, B, W, T) => `${W.f} use_${u}(v§V) { ${body} }
function make_${u}(n§N) { return n % 20 === 7 ? ${B} : ${A}; }
${W.f} attempt_${u}(n§N) { try { return show(${W.a("use_" + u + "(make_" + u + "(n))")}); } catch (e) { return thrown(e); } }
{ const answers§L = []; for (let n = 0; n < turns; n++) answers.push(${W.w}attempt_${u}(n)); note("${u}", answers); }
`,
  local: (u, body, A, B, W, T) => `${W.f} use_${u}(turn§N) { const v§V = turn % 20 === 7 ? ${B} : ${A}; ${body} }
${W.f} attempt_${u}(n§N) { try { return show(${W.a("use_" + u + "(n)")}); } catch (e) { return thrown(e); } }
{ const answers§L = []; for (let n = 0; n < turns; n++) answers.push(${W.w}attempt_${u}(n)); note("${u}", answers); }
`,
  keptInALoop: (u, body, A, B, W, T) => `${W.f} use_${u}(v§V) { ${body} }
${W.f} walk_${u}(length§N) { let v§V = ${A}, out; for (let n = 0; n < length; n++) { if (n === 27) v = ${B}; out = ${W.w}use_${u}(v); } return out; }
${W.f} attempt_${u}(length§N) { try { return show(${W.a("walk_" + u + "(length)", 1500)}); } catch (e) { return thrown(e); } }
{ const answers§L = []; for (let n = 0; n < attempts; n++) answers.push(${W.w}attempt_${u}(n % 2 ? 40 : 20)); note("${u}", answers); }
`,
  keptFromAMaker: (u, body, A, B, W, T) => `${W.f} use_${u}(v§V) { ${body} }
${W.typed ? `let make_${u} = function ` : `function make_${u}`}(value§N, keep§B) { const made = ${B}; if (keep) return made; return value + 1; }${W.typed ? ";" : ""}
${W.f} walk_${u}(at§N) { let total = 0, kept§V = ${A}; for (let i = 0; i < 60; i++) { const result = make_${u}(i, i === at); if (typeof result === "number") total += result; else kept = result; } return [total, ${W.w}use_${u}(kept)]; }
${W.f} attempt_${u}(at§N) { try { return show(${W.a("walk_" + u + "(at)", 1500)}); } catch (e) { return thrown(e); } }
{ const answers§L = []; for (let n = 0; n < attempts; n++) answers.push(${W.w}attempt_${u}(n % 2 ? 47 : 1000)); note("${u}", answers); }
function replace_${u}() { make_${u} = new Proxy(make_${u}, {}); }
if (one === 2) replace_${u}();
`,
  memberOfGiven: (u, body, A, B, W, T) => `${W.f} use_${u}(v§V) { ${body} }
${W.f} ask_${u}(holder§H) { return use_${u}(holder.held); }
${W.f} attempt_${u}(v§V) { try { return show(${W.a("ask_" + u + "(new Holder(v))")}); } catch (e) { return thrown(e); } }
{ const answers§L = []; for (let n = 0; n < turns; n++) answers.push(${W.w}attempt_${u}(${A})); for (let n = 0; n < 3; n++) answers.push(${W.w}attempt_${u}(${B})); answers.push(${W.w}attempt_${u}(${A})); note("${u}", answers); }
`,
  walkOfMember: (u, body, A, B, W, T) => `${W.f} use_${u}(v§V) { ${body} }
${W.f} ask_${u}(holder§H) { return use_${u}(holder.held[Symbol.iterator]()); }
${W.f} attempt_${u}(v§V) { try { return show(${W.a("ask_" + u + "(new Holder(v))")}); } catch (e) { return thrown(e); } }
{ const answers§L = []; for (let n = 0; n < turns; n++) answers.push(${W.w}attempt_${u}(${A})); for (let n = 0; n < 3; n++) answers.push(${W.w}attempt_${u}(${B})); answers.push(${W.w}attempt_${u}(${A})); note("${u}", answers); }
`,
  memberOfALiteral: (u, body, A, B, W, T) => `${W.f} use_${u}(v§V) { ${body} }
${W.f} ask_${u}(n§N) { const box = n % 20 === 7 ? { kind: 1§C, held: ${B}, more: n } : { kind: 0§C, held: ${A} }; return use_${u}(box.held); }
${W.f} attempt_${u}(n§N) { try { return show(${W.a("ask_" + u + "(n)")}); } catch (e) { return thrown(e); } }
{ const answers§L = []; for (let n = 0; n < turns; n++) answers.push(${W.w}attempt_${u}(n)); note("${u}", answers); }
`,
  memberByTag: (u, body, A, B, W, T) => `${W.f} use_${u}(v§V) { ${body} }
${W.f} ask_${u}(n§N) { const box = n % 20 === 7 ? { kind: 1§C, held: ${B} } : { kind: 0§C, other: ${A} }; return use_${u}(box.kind === 1 ? box.held : box.other); }
${W.f} attempt_${u}(n§N) { try { return show(${W.a("ask_" + u + "(n)")}); } catch (e) { return thrown(e); } }
{ const answers§L = []; for (let n = 0; n < turns; n++) answers.push(${W.w}attempt_${u}(n)); note("${u}", answers); }
`,
  boxKeptInALoop: (u, body, A, B, W, T) => `${W.f} use_${u}(v§V) { ${body} }
${W.f} walk_${u}(at§N) { let box§X = { kind: 0, other: ${A} }, out; for (let i = 0; i < 40; i++) { if (i === at) box = { kind: 1, held: ${B} }; out = ${W.w}use_${u}(box.kind === 1 ? box.held : box.other); } return out; }
${W.f} attempt_${u}(at§N) { try { return show(${W.a("walk_" + u + "(at)", 1500)}); } catch (e) { return thrown(e); } }
{ const answers§L = []; for (let n = 0; n < attempts; n++) answers.push(${W.w}attempt_${u}(n % 2 ? 27 : 1000)); note("${u}", answers); }
`,
  captured: (u, body, A, B, W, T) => `function maker_${u}(v§V) { return ${W.f === "function" ? "" : "async "}() => { ${body} }; }
${W.f} attempt_${u}(n§N) { try { return show(${W.a("maker_" + u + "(n % 20 === 7 ? " + B + " : " + A + ")()")}); } catch (e) { return thrown(e); } }
{ const answers§L = []; for (let n = 0; n < turns; n++) answers.push(${W.w}attempt_${u}(n)); note("${u}", answers); }
`,
  capturedThenChanged: (u, body, A, B, W, T) => `${W.f} use_${u}(turn§N) { let v§V = ${A}; const read = ${W.w ? "async " : ""}() => { ${body} }; if (turn % 20 === 7) v = ${B}; return read(); }
${W.f} attempt_${u}(n§N) { try { return show(${W.a("use_" + u + "(n)")}); } catch (e) { return thrown(e); } }
{ const answers§L = []; for (let n = 0; n < turns; n++) answers.push(${W.w}attempt_${u}(n)); note("${u}", answers); }
`,
  capturedInEachTurn: (u, body, A, B, W, T) => `${W.f} use_${u}(turn§N) { let last = null; for (let i = 0; i < 3; i++) { const v§V = (turn + i) % 20 === 7 ? ${B} : ${A}; const read = ${W.w ? "async " : ""}() => { ${body} }; if (i === 1) last = read; } return last§Q(); }
${W.f} attempt_${u}(n§N) { try { return show(${W.a("use_" + u + "(n)")}); } catch (e) { return thrown(e); } }
{ const answers§L = []; for (let n = 0; n < turns; n++) answers.push(${W.w}attempt_${u}(n)); note("${u}", answers); }
`,
  moduleVariable: (u, body, A, B, W, T) => `let held_${u}§V = ${A};
${W.f} use_${u}() { const v = held_${u}; ${body} }
${W.f} attempt_${u}() { try { return show(${W.a("use_" + u + "()")}); } catch (e) { return thrown(e); } }
{ const answers§L = []; for (let n = 0; n < turns; n++) { if (n % 20 === 7) held_${u} = ${B}; else if (n % 20 === 10) held_${u} = ${A}; answers.push(${W.w}attempt_${u}()); } note("${u}", answers); }
`,
  asThis: (u, body, A, B, W, T) => `${W.f} use_${u}(§W) { const v = this; ${body} }
${W.f} attempt_${u}(v§V) { try { return show(${W.a("use_" + u + ".call(v)")}); } catch (e) { return thrown(e); } }
{ const answers§L = []; for (let n = 0; n < turns; n++) answers.push(${W.w}attempt_${u}(${A})); for (let n = 0; n < 3; n++) answers.push(${W.w}attempt_${u}(${B})); answers.push(${W.w}attempt_${u}(${A})); note("${u}", answers); }
`,
  caught: (u, body, A, B, W, T) => `${W.f} use_${u}(turn§N) { try { throw turn % 20 === 7 ? ${B} : ${A}; } §K ${body} } }
${W.f} attempt_${u}(n§N) { try { return show(${W.a("use_" + u + "(n)")}); } catch (e) { return thrown(e); } }
{ const answers§L = []; for (let n = 0; n < turns; n++) answers.push(${W.w}attempt_${u}(n)); note("${u}", answers); }
`,
  awaited: (u, body, A, B, W, T) => `async function use_${u}(turn§N) { const v§I = await (turn % 20 === 7 ? ${B} : ${A}); ${body} }
async function attempt_${u}(n§N) { try { return show(await timed(use_${u}(n), 30)); } catch (e) { return thrown(e); } }
{ const answers§L = []; for (let n = 0; n < turns; n++) answers.push(await attempt_${u}(n)); note("${u}", answers); }
`,
};
const plainForm: Form = { f: "function", w: "", a: call => call };
const waitingForm: Form = { f: "async function", w: "await ", a: (call, limit = 30) => `await timed(${call}, ${limit})` };
function pairs(births: Record<string, string[]>, which = "") {
  // Across kinds: a few births of each kind stand for it, the first of them in the first round. Within a kind: every pair.
  const byKind: Record<string, string[]> = {};
  for (const [name, [kind]] of Object.entries(births)) (byKind[kind] ??= []).push(name);
  const stand: Record<string, string[]> = { string: ["rope", "literal"], number: ["fraction", "integer"], function: ["closure", "arrow", "classValue", "native", "closuresInARing", "closureOverItsHolder"], promise: ["asyncCall", "resolved"], error: ["error", "errorOfEngine"], boxed: ["boxedString"], walk: ["generatorWalk", "stringWalk"] };
  const chosen = Object.entries(byKind).flatMap(([kind, names]) => stand[kind] ?? names.slice(0, 1)), isFirst = (name: string) => (stand[births[name][0]] ?? byKind[births[name][0]])[0] === name;
  const made: string[][] = [];
  for (const a of chosen) for (const b of chosen) if (a !== b && births[a][0] !== births[b][0] && (!which || which === "across" || (which === "first") === (isFirst(a) && isFirst(b))) && which !== "within") made.push([a, b]);
  if (!which || which === "within") for (const names of Object.values(byKind)) for (const a of names) for (const b of names) if (a !== b) made.push([a, b]);
  return made;
}
// What is hot is the hottest fifth of a program's own code. Where every place of a program is visited equally often few of them would be hot, so beside each stand copies of it that run once.
const runsOnce = (u: string, body: string, A: string, W: Form, copies: number) =>
  Array.from({ length: copies }, (_, k) => `${W.f} once_${u}_${k}(v§V) { ${body} }\ntry { once_${u}_${k}(${A})${W.w ? ".catch(() => {})" : ""}; } catch {}\n`).join("");
// A mark is nothing in JavaScript and an annotation in TypeScript. V is the type of the two births together, as the checker infers it.
const marks: Record<string, string> = {
  V: ": V", N: ": number", B: ": boolean", A: ": any", T: ": string", L: ": string[]", H: ": Holder", C: " as const", W: "this: V", Y: "this: any, ", X: ": { kind: 0; other: V } | { kind: 1; held: V }",
  M: " as { absent?: undefined }", Z: " as any", E: " as Error", S: " as string", U: " as number", P: "<number>", G: " as Function", O: ": (value: number) => void", J: ": (reason: any) => void", I: ": Awaited<V>", Q: "!", R: "?: any", D: ": any[]",
  Fa: "a: any;", Fq: "q: any;", Fh: "held: V;", K: "catch (caught) { const v = caught as V;",
};
const marked = (text: string, typed: boolean) => text.replace(/§<(\w+)>/g, (_, type) => (typed ? ` as ${type}` : "")).replace(/§(F[aqh]|[A-Z])/g, (_, mark) => (typed ? marks[mark] : mark === "K" ? "catch (v) {" : ""));
// A function that never runs may put another callee in the place of the use: what the use is given is anything until the call is resolved, and of two kinds from then on.
const veil = (u: string) => `function veil_${u}() { use_${u} = new Proxy(use_${u}, {}); }\nif (one === 2) veil_${u}();\n`;
/** Every run takes one program in two hundred: a program holds some hundreds of places. */
export const oneIn = 200;
// Every use in one function: each is a block of its own, its answer is held in a local until the end, and what it throws is caught around it. One value has hundreds of uses and hundreds of locals live together.
function joinedInOne(name: string, every: [string, string, boolean][]): [string, string, boolean] {
  // But those that hold an inner function with statements of its own.
  const uses = every.filter(([, body]) => !/=>\s*\{|\bfunction\b/.test(body));
  const blocks = uses.map(([, body], k) => `try { L${k}: { ${body.replace(/\breturn ([^;]+);/g, (_, answer) => `{ r${k} = ${answer}; break L${k}; }`)} } } catch (e) { r${k} = thrown(e); }`);
  return [name, `let ${uses.map((_, k) => `r${k}`).join(", ")}; ${blocks.join(" ")} return [${uses.map((_, k) => `r${k}`).join(", ")}];`, uses.some(([, , waits]) => waits)];
}
/** which: "first" | "second" | "across" | "within", or all. onePlace: a program for every use. wanted: the names to make. */
export function programsWith(typed = false, { which = "", turns = 60, onePlace = false, ballast = 8, veiled = false, hidden = false, half = false, only = /./, joined = false, wanted = (name: string) => true } = {}) {
  const { births, uses, waits } = parts();
  const made: { name: string; file: string; readonly text: string }[] = [];
  const one = onePlace, T = turns, order = Object.keys(births);
  for (const [a, b] of pairs(births, which)) for (const [r, road] of Object.entries(roads)) {
    if (!one && !wanted(`${a}-${b}-${r}`)) continue;
    if (half && order.indexOf(a) > order.indexOf(b)) continue;
    // Hidden: the second birth comes through a function that another may replace, so nobody knows its kind until that call is resolved.
    const A = births[a][1], B = hidden ? `hide(${births[b][1]})` : births[b][1], walked = ["string", "walk", "boxed"];
    if (r === "walkOfMember" && (typed || !(walked.includes(births[a][0]) && walked.includes(births[b][0])))) continue;
    const placesOf = (): [string, () => string][] => {
      // The checker rejects a test of what is always true.
      const isAlwaysTrue = [births[a][0], births[b][0]].every(kind => kind === "promise" || kind === "thenable") || [births[a][0], births[b][0]].every(kind => kind === "function");
      // A group of uses that means nothing to either kind, each of them a TypeError or NaN, is cut to its first three.
      let meant = true, taken = 0;
      const means = ([u]: [string, string]) => {
        if (Object.hasOwn(groups, u)) [meant, taken] = [groups[u] === "all" || [births[a][0], births[b][0]].some(kind => groups[u].split(" ").includes(kind)), 0];
        return meant || taken++ < 3;
      };
      const all: [string, string, boolean][] = [...Object.entries(uses).filter(means).map(([u, body]): [string, string, boolean] => [u, body, false]), ...Object.entries(waits).filter(means).map(([u, body]): [string, string, boolean] => [u, body, true])].filter(([u]) => !(ordersTexts.has(u) && [births[a][0], births[b][0]].includes("function"))).filter(([u]) => !(u === "ownNames" && [births[a][0], births[b][0]].includes("error"))).filter(([u]) => !typed || (takenOfAnyType.has(u) && !(isAlwaysTrue && testsTruth.has(u)) && !(r === "awaited" && u.endsWith("OfTwo"))));
      // What is awaited is no promise any more, and what walks a value is not of its kind.
      if (r !== "walkOfMember" && !(r === "awaited" && [births[a][0], births[b][0]].some(kind => kind === "promise" || kind === "thenable"))) all.push(...guarded(births[a][0], births[b][0], order.indexOf(a) + order.indexOf(b)).filter(([u]) => !(typed && r === "capturedThenChanged" && /^(testKept|inClosure)/.test(u))));
      const chosen = all.filter(([u, , waits]) => only.test(u) && !(waits && r === "awaited"));
      return (joined ? [joinedInOne("everyUse", chosen.filter(([, , waits]) => !waits)), joinedInOne("everyWait", chosen.filter(([, , waits]) => waits))].filter(([, body]) => body.includes("try")) : chosen).map(([u, body, waits]) => [u, () => road(u, body, A, B, { ...(waits ? waitingForm : plainForm), typed }, T) + (veiled && r !== "captured" ? veil(u) : "") + (one ? "" : runsOnce(u, body, A, waits ? waitingForm : plainForm, ballast))]);
    };
    const file = typed ? "program.ts" : "program.mjs";
    const whole = (text: string) => marked(head + `const turns = process.env.FEWER_TURNS ? 9 : ${T}, attempts = process.env.FEWER_TURNS ? 2 : 6;\n` + (hidden ? "function hide(v) { return v; }\nfunction neverRuns() { hide = new Proxy(hide, {}); }\nif (one === 2) neverRuns();\n" : "") + `let flips = 0;\nfunction other() { return flips++ & 1 ? ${B} : ${A}; }\n` + (typed ? `const firstBirth = () => ${A}, secondBirth = () => ${B};\ntype V = ReturnType<typeof firstBirth> | ReturnType<typeof secondBirth>;\ntype AnyPromise = Promise<any>;\n` : "") + text + (typed ? "export {};\n" : ""), typed);
    // The text is made when it is asked for: all of them together are three gigabytes.
    if (one) for (const [u, text] of placesOf()) wanted(`${u}-${a}-${b}-${r}`) && made.push({ name: `${u}-${a}-${b}-${r}`, file, get text() { return whole(text()); } });
    else made.push({ name: `${a}-${b}-${r}`, file, get text() { return whole(placesOf().map(([, text]) => text()).join("")); } });
  }
  return made;
}

export function programs(typed = false) {
  const called = (suffix: string, flags: string[] | undefined, list: ReturnType<typeof programsWith>) => list.map(program => ({ name: program.name + suffix, file: program.file, flags, get text() { return program.text; } }));
  if (typed) return called("", undefined, programsWith(true));
  return [...called("", undefined, programsWith()), ...called("-joined", undefined, programsWith(false, { joined: true, ballast: 0 }))];
}
