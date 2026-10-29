// A string that was joined and never read is still in pieces. Whatever needs its characters puts them together first: that allocates, and may collect, in the middle of an operator or a built-in that looks harmless.
//
//   text      words, Latin-1, 16-bit with a surrogate pair cut by the joint, numbers, indexes, names of properties, JSON, hex, base64, blanks, dates, paths, patterns; from two characters to megabytes
//   joined    by + from the left and from the right, in halves, by templates, by concat, a slice of a flat string, a slice of pieces, pieces of pieces; straight from the maker or out of a field, an element, a Map, a closure
//   uses      every method of String, as receiver and as argument; conversions to numbers, one by one and as a list handed over by apply or a spread; comparisons and switches; keys of objects, Maps and Sets; JSON, URLs, dates, patterns, encoders, Buffers, hashes, paths, errors, symbols
//   around    objects made in front of the use and behind it, fields, elements and lengths read on both sides, in a loop, in an async function, in a generator, in a handler
//   too long  joints whose result would pass the longest length, by every operator and method that joins
//
// Each use runs on the pieces and on a flat twin of the same text, and must answer alike; every object made around it must hold what it was given. The program prints what is wrong, and a digest of all answers.
import type { Random } from "./random";

const prelude = `declare function require(name: string): any;
declare const Buffer: any;
declare const Bun: any;
const wrong = new Set<string>();
let digest = 0;
class Point {
  x: number;
  y: number;
  name: string;
  constructor(x: number, y: number, name: string) {
    this.x = x;
    this.y = y;
    this.name = name;
  }
}
class Holder {
  text: string;
  count: number;
  constructor(text: string, count: number) {
    this.text = text;
    this.count = count;
  }
}
function hashOf(text: string): number {
  let hash = text.length;
  const step = text.length > 4000 ? Math.floor(text.length / 1000) : 1;
  for (let i = 0; i < text.length; i += step) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  return hash;
}
function show(value: unknown): string {
  if (typeof value === "string") return value.length <= 40 ? JSON.stringify(value) : "text " + value.length + " #" + hashOf(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return "symbol " + show(value.description);
  if (value === null || typeof value !== "object") return String(value);
  if (Array.isArray(value)) return "[" + value.length + ": " + value.slice(0, 3).map(show).join() + (value.length > 3 ? " .. " + show(value[value.length - 1]) : "") + "]";
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    let sum = 0;
    for (let i = 0; i < bytes.length; i++) sum = (Math.imul(sum, 33) + bytes[i]) | 0;
    return "bytes " + bytes.length + " #" + sum;
  }
  if (value instanceof Error) return value.name + ": " + value.message.slice(0, 60);
  if (value instanceof Date) return "date " + value.getTime();
  if (value instanceof Map || value instanceof Set) return "size " + value.size;
  return "{" + Object.keys(value).slice(0, 4).map(show).join() + "}";
}
function flatTwin(text: string): string {
  return JSON.parse(JSON.stringify(text));
}
function inHalves(pieces: string[], from: number, to: number): string {
  if (to - from === 1) return pieces[from];
  const middle = (from + to) >> 1;
  return inHalves(pieces, from, middle) + inHalves(pieces, middle, to);
}
const table: Record<string, number> = { alpha: 1, beta: 2, length: 3, "10": 4, "42": 5, toString: 6, "a b": 7 };
const list: number[] = Array.from({ length: 64 }, (_, i) => i * 3);
const byText = new Map<string, number>([["alpha", 1], ["beta", 2], ["42", 3], ["gamma delta", 4]]);
const texts = new Set<string>(["alpha", "42", "length"]);
const hay = flatTwin("alpha beta gamma delta 42 length abcdefghij caf\\u00e9 \\u4e2d\\ud83d\\ude00 a+(b|c)*$ 123.5e2");
function listMax(a: string[]): string {
  const b = a as any;
  const x = a[0];
  const n = Math.max.apply(null, b);
  return n + "|" + x.length + "|" + a[0].length + "|" + a[1].length + "|" + a.length;
}
function listMin(a: string[]): string {
  const b = a as any;
  const x = a[0];
  const n = Math.min(...b);
  return n + "|" + x.length + "|" + a[0].length + "|" + a.length;
}
const keptPoints: Point[] = [];
const keptSums: number[] = [];
function keep(point: Point): void {
  const at = keptPoints.length < 96 ? keptPoints.length : (point.x >>> 0) % 96;
  keptPoints[at] = point;
  keptSums[at] = point.x * 3 + point.y;
}
function checkKept(where: string): void {
  for (let i = 0; i < keptPoints.length; i++) {
    const point = keptPoints[i];
    if (point.x * 3 + point.y !== keptSums[i] || point.name !== "p" + point.x) wrong.add(where + ": a point holds something else");
  }
}
function note(where: string, pieces: string, flat: string): void {
  if (pieces !== flat) wrong.add(where + ": " + pieces.slice(0, 120) + " for " + flat.slice(0, 120));
  digest = (Math.imul(digest, 31) + hashOf(flat)) | 0;
}`;

type Text = { name: string; pieces: string[]; filler?: string; fillerAt?: number };

const textKinds: Text[] = [
  { name: "words", pieces: ["alpha ", "beta", " gamma", " delta"], filler: "abcdefghij" },
  { name: "two-characters", pieces: ["a", "b"] },
  { name: "latin-1", pieces: ["café ", "naïve", " über"], filler: "éèabc" },
  { name: "wide", pieces: ["abc", "中文", "def"], filler: "中x" },
  { name: "wide-last", pieces: ["abcdef", "ghijkl", "中"], filler: "abcdefghij", fillerAt: 1 },
  { name: "cut-pair", pieces: ["a\ud83d", "\ude00b", "\ud83d", "\ude01"], filler: "\ude00\ud83d" },
  { name: "lone-halves", pieces: ["\ude00a", "b\ud83d"] },
  { name: "number", pieces: ["12", "3.5", "e2"] },
  { name: "negative-zero", pieces: ["-", "0"] },
  { name: "hex-number", pieces: ["0x", "ff"] },
  { name: "infinity", pieces: ["Inf", "inity"] },
  { name: "blank-number", pieces: [" \n4", "2\t "] },
  { name: "index", pieces: ["4", "2"] },
  { name: "index-ten", pieces: ["1", "0"] },
  { name: "large-index", pieces: ["42949", "67295"] },
  { name: "not-an-index", pieces: ["0", "1"] },
  { name: "name-alpha", pieces: ["al", "pha"] },
  { name: "name-length", pieces: ["len", "gth"] },
  { name: "name-to-string", pieces: ["to", "String"] },
  { name: "name-proto", pieces: ["__pro", "to__"] },
  { name: "name-x", pieces: ["", "x"] },
  { name: "json", pieces: ['{"a":[1,', '2,"x', 'y"],', '"b":null}'], filler: "zz", fillerAt: 2 },
  { name: "json-list", pieces: ["[1,", "2,", "3]"], filler: "7,", fillerAt: 1 },
  { name: "hex", pieces: ["68", "656c", "6c6f"], filler: "61" },
  { name: "base64", pieces: ["aGVs", "bG8h"], filler: "YWJj" },
  { name: "blanks", pieces: ["  \t", "a b", "\n  "], filler: " " },
  { name: "date", pieces: ["2020-01", "-02T03:04", ":05Z"] },
  { name: "path", pieces: ["a/b", "/../c/", "./d.txt"], filler: "e/" },
  { name: "query", pieces: ["q=1&r", "=2&s=%", "41+b"], filler: "&t=1" },
  { name: "pattern", pieces: ["a+", "(b|c)", "*$"] },
  { name: "percent", pieces: ["%E4%B8", "%AD%2", "0x"], filler: "%41" },
  { name: "markup", pieces: ["<a href=\"", "x&y\">", "'</a>"], filler: "&<" },
];

const makers: Record<string, string> = {
  "from-the-left": "let s = p[0];\n  for (let i = 1; i < p.length; i++) s = s + p[i];\n  return s;",
  "from-the-right": "let s = p[p.length - 1];\n  for (let i = p.length - 2; i >= 0; i--) s = p[i] + s;\n  return s;",
  "added-to": 'let s = "";\n  for (const piece of p) s += piece;\n  return s;',
  "in-halves": "return inHalves(p, 0, p.length);",
  templates: 'let s = "";\n  for (let i = 0; i < p.length; i += 2) s = i + 1 < p.length ? `${s}${p[i]}${p[i + 1]}` : `${s}${p[i]}`;\n  return s;',
  concat: "return p[0].concat(...p.slice(1));",
  "slice-of-flat": 'const whole = flatTwin("<<" + p.join("") + ">>");\n  return whole.slice(2, whole.length - 2);',
  "substring-of-flat": 'const whole = flatTwin("<" + p.join("") + ">");\n  return whole.substring(1, whole.length - 1);',
  "slice-of-pieces": 'let s = "<<";\n  for (const piece of p) s += piece;\n  s += ">>";\n  return s.slice(2, s.length - 2);',
  "slices-joined": 'const whole = flatTwin(p.join(""));\n  const middle = whole.length >> 1;\n  return whole.slice(0, middle) + whole.slice(middle);',
  "pieces-of-pieces": "const middle = (p.length + 1) >> 1;\n  const left = inHalves(p, 0, middle);\n  return middle < p.length ? (left + inHalves(p, middle, p.length)) : left + p[0].slice(0, 0);",
  flat: 'return flatTwin(p.join(""));',
};

// [name, expression over `s`, the longest text it is given]
type Use = [string, string, number?];
const small = 3000;
const uses: Use[] = [
  ["length", "s.length"],
  ["at", "s.at(-1)"],
  ["char-at", "s.charAt(s.length >> 1)"],
  ["char-code-at", "s.charCodeAt(s.length - 1)"],
  ["code-point-at", "s.codePointAt(1)"],
  ["element", "s[s.length >> 1]"],
  ["element-first", "s[0]"],
  ["element-outside", "s[s.length]"],
  ["index-of", 's.indexOf("b")'],
  ["last-index-of", 's.lastIndexOf("a")'],
  ["includes", 's.includes("ph")'],
  ["starts-with", 's.startsWith("al")'],
  ["ends-with", 's.endsWith("a")'],
  ["slice", "s.slice(1, -1)"],
  ["slice-and-read", "s.slice(1).charCodeAt(0)"],
  ["substring", "s.substring(1, 3)"],
  ["substr", "(s as any).substr(1, 2)"],
  ["split", 's.split("a")', small],
  ["split-all", 's.split("")', small],
  ["split-pattern", "s.split(/[ab]/)", small],
  ["replace", 's.replace("a", "<$&>")'],
  ["replace-pattern", 's.replace(/[a-c]+/g, "_")', 200000],
  ["replace-function", "s.replace(/[a-c]/g, found => found.toUpperCase() + s.length)", small],
  ["replace-all", 's.replaceAll("a", "aa")', 200000],
  ["match", "s.match(/[a-z]+/g)", small],
  ["match-all", "[...s.matchAll(/(a)(.)?/g)].length", small],
  ["search", "s.search(/[b-d]/)"],
  ["upper", "s.toUpperCase()"],
  ["lower", "s.toLowerCase()"],
  ["locale-upper", "s.toLocaleUpperCase()", 200000],
  ["trim", "s.trim()"],
  ["trim-start", "s.trimStart().length + s.trimEnd().length"],
  ["pad-start", 's.padStart(s.length + 3, "xy")'],
  ["pad-end-with", '"q".padEnd(9, s)'],
  ["repeat", "s.repeat(2)"],
  ["repeat-and-read", "s.repeat(3).charCodeAt(s.length + 1)"],
  ["concat", 's.concat("!", s)'],
  ["normalize", 's.normalize("NFD")', 200000],
  ["locale-compare", 's.localeCompare("alpha")', small],
  ["well-formed", "(s as any).isWellFormed()"],
  ["to-well-formed", "(s as any).toWellFormed()"],
  ["for-of", "(() => {\n    let n = 0;\n    for (const c of s) n = (n * 7 + c.length + c.charCodeAt(0)) | 0;\n    return n;\n  })()", 200000],
  ["spread", "[...s]", small],
  ["array-from", "Array.from(s, c => c.charCodeAt(0))", small],
  ["raw", "String.raw`<${s}>`"],
  ["as-needle", "hay.indexOf(s)"],
  ["as-needle-includes", "hay.includes(s)"],
  ["as-prefix", "hay.startsWith(s)"],
  ["as-separator", "hay.split(s)"],
  ["as-searched", 'hay.replace(s, "#")'],
  ["as-replacement", 'hay.replace("beta", s)'],
  ["as-replacement-all", 'hay.replaceAll("a", s)', small],
  ["as-compared", "hay.localeCompare(s)", small],
  ["number", "Number(s)", small],
  ["plus", "+s", small],
  ["times", "(s as any) * 2", small],
  ["minus", "(s as any) - 1", small],
  ["or-zero", "(s as any) | 0", small],
  ["shift", "(s as any) >>> 1", small],
  ["negate", "-(s as any)", small],
  ["increment", "(() => {\n    let n: any = s;\n    n++;\n    return n;\n  })()", small],
  ["parse-int", "parseInt(s)"],
  ["parse-int-16", "parseInt(s, 16)"],
  ["parse-float", "parseFloat(s)"],
  ["big-int", "(() => {\n    try {\n      return BigInt(s);\n    } catch (error) {\n      return (error as Error).name;\n    }\n  })()", small],
  ["math-max", "Math.max(s as any, 1)", small],
  ["math-max-apply", "Math.max.apply(null, [s, s] as any)", small],
  ["math-min-spread", "Math.min(...([s, 7] as any[]))", small],
  ["math-abs", "Math.abs(s as any)", small],
  ["math-floor", "Math.floor(s as any)", small],
  ["math-pow", "Math.pow(s as any, 2)", small],
  ["math-imul", "Math.imul(s as any, 3)", small],
  ["math-hypot", "Math.hypot(s as any, s as any)", small],
  ["is-nan", "isNaN(s as any)", small],
  ["is-finite", "isFinite(s as any)", small],
  ["to-fixed-of", "Number(s).toFixed(2)", small],
  ["loosely-equal-number", "(s as any) == 42", small],
  ["loosely-equal-text", '(s as any) == "alpha"'],
  ["equal", 's === "alpha"'],
  ["equal-twin", "s === flatTwin(s + \"\")"],
  ["equal-pieces", '(s + "x") === (s + "x")'],
  ["unequal-pieces", '(s + "x") !== (s + "y")'],
  ["less", 's < "b"'],
  ["less-pieces", '(s + "a") < (s + "b")'],
  ["less-number", "(s as any) < 100", small],
  ["object-is", 'Object.is(s, "42")'],
  ["switch", '(() => {\n    switch (s) {\n      case "alpha":\n        return 1;\n      case "42":\n        return 2;\n      case "length":\n        return 3;\n      case "ab":\n        return 4;\n      default:\n        return 0;\n    }\n  })()'],
  ["truthy", "s ? 1 : 2"],
  ["typeof", "typeof s"],
  ["in", "s in table", small],
  ["read-by", "table[s]", small],
  ["store-by", "(() => {\n    const o: Record<string, number> = { alpha: 1 };\n    o[s] = 5;\n    return Object.keys(o).length + \":\" + o[s];\n  })()", small],
  ["delete-by", "(() => {\n    const o: Record<string, number> = { alpha: 1, beta: 2, 42: 3 };\n    delete o[s];\n    return Object.keys(o).join();\n  })()", small],
  ["computed-key", "Object.keys({ [s]: 1, alpha: 2 })", small],
  ["has-own", "Object.hasOwn(table, s)", small],
  ["reflect-get", "Reflect.get(table, s)", small],
  ["element-by", "list[s as any]", small],
  ["element-store-by", "(() => {\n    const a: number[] = [1, 2, 3];\n    a[s as any] = 9;\n    return a.length;\n  })()", small],
  ["field-by", "(new Point(1, 2, \"p\") as any)[s]", small],
  ["text-by", "(hay as any)[s]", small],
  ["method-by", "typeof (hay as any)[s]", small],
  ["define-by", "Object.getOwnPropertyNames(Object.defineProperty({}, s, { value: 1 }))", small],
  ["map-get", "byText.get(s)"],
  ["map-has", "byText.has(s)"],
  ["map-set", "new Map<string, number>([[\"alpha\", 1]]).set(s, 2).size"],
  ["set-has", "texts.has(s)"],
  ["set-add", 'new Set<string>(["alpha", "42"]).add(s).size'],
  ["map-of-pieces", '(() => {\n    const m = new Map<string, number>();\n    m.set(s + "k", 1);\n    return m.get(s + "k");\n  })()'],
  ["group-by", "Object.keys((Object as any).groupBy([1, 2], () => s))", small],
  ["from-entries", "Object.fromEntries([[s, 1]])", small],
  ["symbol-for", "Symbol.for(s) === Symbol.for(flatTwin(s + \"\"))", small],
  ["symbol", "Symbol(s)", small],
  ["json-parse", "(() => {\n    try {\n      return JSON.parse(s);\n    } catch (error) {\n      return (error as Error).name;\n    }\n  })()", 200000],
  ["json-stringify", "JSON.stringify(s)"],
  ["json-of-object", "JSON.stringify({ a: s, [s.slice(0, 5)]: [s] })"],
  ["json-indent", "JSON.stringify([1, [2]], null, s)", small],
  ["encode-component", "(() => {\n    try {\n      return encodeURIComponent(s);\n    } catch (error) {\n      return (error as Error).name;\n    }\n  })()", 200000],
  ["decode-component", "(() => {\n    try {\n      return decodeURIComponent(s);\n    } catch (error) {\n      return (error as Error).name;\n    }\n  })()", 200000],
  ["encode-uri", "(() => {\n    try {\n      return encodeURI(s);\n    } catch (error) {\n      return (error as Error).name;\n    }\n  })()", 200000],
  ["escape", "(globalThis as any).escape(s)", 200000],
  ["unescape", "(globalThis as any).unescape(s)", 200000],
  ["btoa", "(() => {\n    try {\n      return btoa(s);\n    } catch (error) {\n      return (error as Error).name;\n    }\n  })()"],
  ["atob", "(() => {\n    try {\n      return atob(s);\n    } catch (error) {\n      return (error as Error).name;\n    }\n  })()"],
  ["encoder", "new TextEncoder().encode(s)"],
  ["encode-into", "new TextEncoder().encodeInto(s, new Uint8Array(16)).written"],
  ["buffer-from", "Buffer.from(s)"],
  ["buffer-from-hex", 'Buffer.from(s, "hex")'],
  ["buffer-from-base64", 'Buffer.from(s, "base64")'],
  ["buffer-from-latin1", 'Buffer.from(s, "latin1")'],
  ["buffer-from-utf16", 'Buffer.from(s, "utf16le")'],
  ["buffer-byte-length", "Buffer.byteLength(s)"],
  ["buffer-write", "(() => {\n    const b = Buffer.alloc(24);\n    b.write(s, 1);\n    return b;\n  })()"],
  ["buffer-fill", "Buffer.alloc(16).fill(s)", small],
  ["buffer-index-of", "Buffer.from(hay).indexOf(s)", small],
  ["buffer-includes", "Buffer.from(hay).includes(s)", small],
  ["buffer-concat", "Buffer.concat([Buffer.from(s), Buffer.from(s)]).length"],
  ["url", '(() => {\n    try {\n      return new URL(s, "http://host/base/").href;\n    } catch (error) {\n      return (error as Error).name;\n    }\n  })()', small],
  ["url-parameters", "[...new URLSearchParams(s)].length", small],
  ["url-parameter-value", '(() => {\n    const q = new URLSearchParams();\n    q.set("k", s);\n    return q.toString();\n  })()', small],
  ["date-parse", "Date.parse(s)", small],
  ["date", "new Date(s)", small],
  ["pattern-of", "(() => {\n    try {\n      return new RegExp(s).test(hay);\n    } catch (error) {\n      return (error as Error).name;\n    }\n  })()", small],
  ["pattern-test", "/b.*a/.test(s)", 200000],
  ["pattern-exec", "/(a)(b)?/.exec(s)?.index", 200000],
  ["pattern-sticky", "(() => {\n    const r = /[a-z ]/y;\n    let n = 0;\n    while (r.test(s) && n < 50) n++;\n    return n;\n  })()"],
  ["error", "new Error(s)"],
  ["error-cause", "(new Error(\"e\", { cause: s }) as any).cause"],
  ["thrown", "(() => {\n    try {\n      throw s;\n    } catch (thrown) {\n      return thrown;\n    }\n  })()"],
  ["join-by", "[1, 2, 3].join(s)"],
  ["joined", "[s, s].join()"],
  ["list-includes", '["alpha", "42", "ab"].includes(s)'],
  ["list-index-of", '["x", "alpha", "42", "ab"].indexOf(s)'],
  ["sorted", '[s + "b", s + "a", s].sort()'],
  ["sorted-by", '[s + "b", s + "a", s].sort((l, r) => (l < r ? 1 : l > r ? -1 : 0))'],
  ["cloned", "structuredClone(s)"],
  ["cloned-inside", "(structuredClone({ a: [s, s] }) as any).a[1]"],
  ["string-of", "String(s)"],
  ["template", "`${s}`"],
  ["plus-number", "s + 1"],
  ["number-plus", "1.5 + s"],
  ["wrapper", "new String(s).length"],
  ["object-keys", "Object.keys(s).length", small],
  ["value-of", "Object(s).valueOf()"],
  ["function-name", "Object.defineProperty(() => 1, \"name\", { value: s }).name"],
  ["collator", "new Intl.Collator(\"en\").compare(s, \"alpha\")", small],
  ["number-format", "new Intl.NumberFormat(\"en\").format(s as any)", small],
  ["hash", "String(Bun.hash(s))"],
  ["escape-markup", "Bun.escapeHTML(s)"],
  ["width", "Bun.stringWidth(s)", 200000],
  ["inspect", "Bun.inspect(s).length", 200000],
  ["deep-equals", "Bun.deepEquals({ a: s }, { a: flatTwin(s + \"\") })"],
  ["sha", 'new Bun.CryptoHasher("sha1").update(s).digest("hex")'],
  ["node-hash", 'require("node:crypto").createHash("md5").update(s).digest("hex")'],
  ["path-join", 'require("node:path").join("/r", s, "z")', small],
  ["path-base", 'require("node:path").basename(s)', small],
  ["path-normalize", 'require("node:path").normalize(s)', small],
  ["format", 'require("node:util").format("%s|%d|%j", s, s, s)', small],
  ["query-parse", 'Object.keys(require("node:querystring").parse(s))', small],
  ["exists", 'require("node:fs").existsSync(s)', small],
  ["blob", "new Blob([s, s]).size"],
  ["headers", '(() => {\n    try {\n      return new Headers({ a: s }).get("a");\n    } catch (error) {\n      return (error as Error).name;\n    }\n  })()', small],
  ["list-max-apply", "listMax([s, s])", small],
  ["list-min-spread", "listMin([s, s])", small],
  ["list-reflect-apply", "Reflect.apply(Math.max, null, loose)", small],
  ["list-hypot-apply", "Math.hypot.apply(null, loose)", small],
  ["list-atan2-apply", "Math.atan2.apply(null, loose)", small],
  ["list-imul-apply", "Math.imul.apply(null, loose)", small],
  ["list-pow-apply", "Math.pow.apply(null, loose)", small],
  ["list-abs-apply", "Math.abs.apply(null, loose)", small],
  ["list-parse-int-apply", "parseInt.apply(null, loose)", small],
  ["list-parse-float-apply", "parseFloat.apply(null, loose)", small],
  ["list-is-nan-apply", "isNaN.apply(null, loose)", small],
  ["list-number-apply", "Number.apply(null, loose)", small],
  ["list-from-char-code-apply", "String.fromCharCode.apply(null, loose)", small],
  ["list-date-utc-apply", "Date.UTC.apply(null, loose)", small],
  ["list-date-spread", "new Date(...(loose as [number, number])).getTime()", small],
  ["list-max-call", "Math.max.call(null, loose[0], loose[1])", small],
  ["list-concat-apply", 'String.prototype.concat.apply("", many)'],
  ["list-index-of-apply", "String.prototype.indexOf.apply(hay, loose)"],
  ["list-push-apply", "(() => {\n    const target: string[] = [];\n    Array.prototype.push.apply(target, many);\n    return target.length + target[1].length;\n  })()"],
  ["list-join", 'many.join("")'],
  ["list-join-and-read", 'many.join("-").charCodeAt(1)'],
  ["list-sort", "many.sort().length"],
  ["list-includes", 'many.includes("alpha")'],
  ["list-index-of", "many.indexOf(hay)"],
  ["list-last-index-of", "many.lastIndexOf(flatTwin(s + \"\"))"],
  ["list-set", "new Set(many).size"],
  ["list-to-string", "String(many).length"],
  ["list-array-of-numbers", "many.map(Number)", small],
  ["list-typed-array", "new Float64Array(loose)", small],
  ["list-typed-array-set", "(() => {\n    const view = new Int32Array(4);\n    view.set(loose, 1);\n    return view;\n  })()", small],
  ["list-typed-array-fill", "new Uint8Array(3).fill(loose[0])", small],
  ["list-typed-array-store", "(() => {\n    const view = new Float32Array(2);\n    view[0] = loose[0];\n    return view;\n  })()", small],
  ["list-data-view", "(() => {\n    const view = new DataView(new ArrayBuffer(8));\n    view.setFloat64(0, loose[0]);\n    return view.getFloat64(0);\n  })()", small],
  ["list-array-length", "(() => {\n    try {\n      const a: number[] = [1, 2, 3];\n      a.length = loose[0];\n      return a.length;\n    } catch (error) {\n      return (error as Error).name;\n    }\n  })()", small],
  ["list-slice-by", "list.slice(loose[0], loose[1]).length", small],
  ["list-at-by", "list.at(loose[0])", small],
  ["list-char-at-by", "hay.charAt(loose[0])", small],
  ["list-repeat-by", "(() => {\n    try {\n      return \"ab\".repeat(loose[0]).length;\n    } catch (error) {\n      return (error as Error).name;\n    }\n  })()", small],
  ["list-to-string-radix", "(() => {\n    try {\n      return (255).toString(loose[0]);\n    } catch (error) {\n      return (error as Error).name;\n    }\n  })()", small],
  ["list-to-fixed-by", "(() => {\n    try {\n      return (1.5).toFixed(loose[0]);\n    } catch (error) {\n      return (error as Error).name;\n    }\n  })()", small],
  ["list-set-timeout-by", "(() => {\n    clearTimeout(setTimeout(() => {}, loose[0]));\n    return 1;\n  })()", small],
  ["environment", "(() => {\n    const e = require(\"node:process\").env;\n    e.PIECES = s;\n    const back = e.PIECES;\n    delete e.PIECES;\n    return back;\n  })()", small],
];

// What stands around the use. `USE` is the expression; `s` is in scope.
const arounds: Record<string, { isAsync?: boolean; body: string }> = {
  bare: { body: "return show(USE);" },
  "objects-on-both-sides": {
    body: `const before = new Point(round, 1, "p" + round);
  const answer = USE;
  const behind = new Point(round + 1000, 2, "p" + (round + 1000));
  keep(before);
  keep(behind);
  return show(answer) + before.x + before.name + behind.y;`,
  },
  "reads-on-both-sides": {
    body: `const first = holder.count + list[3] + list.length + holder.text.length;
  const answer = USE;
  const second = holder.count + list[3] + list.length + holder.text.length;
  return show(answer) + (first === second ? "" : " moved");`,
  },
  "many-objects": {
    body: `const made: Point[] = [];
  for (let i = 0; i < 6; i++) made.push(new Point(round * 8 + i, i, "p" + (round * 8 + i)));
  const answer = USE;
  for (let i = 6; i < 12; i++) made.push(new Point(round * 8 + i, i, "p" + (round * 8 + i)));
  let sum = 0;
  for (const point of made) sum += point.x - round * 8 + point.y + point.name.length;
  keep(made[round % 12]);
  return show(answer) + sum;`,
  },
  "literals-on-both-sides": {
    body: `const before = { a: round, b: [round, round + 0.5], c: "t" + round };
  const answer = USE;
  const behind = { a: round + 1, b: [round + 1, round + 1.5], c: "t" + (round + 1) };
  return show(answer) + (before.a + before.b[1] + behind.a + behind.b[0]) + before.c + behind.c;`,
  },
  "numbers-on-both-sides": {
    body: `const before = [round + 0.25, round * 1e10, -round];
  const answer = USE;
  const behind = [before[0] * 2, before[1] + 0.5, before[2] / 3];
  return show(answer) + behind.join();`,
  },
  "pieces-on-both-sides": {
    body: `const before = holder.text + round;
  const answer = USE;
  const behind = before + holder.text;
  return show(answer) + behind.length + behind.charCodeAt(behind.length - 1);`,
  },
  "twice-in-a-row": { body: "const first = show(USE);\n  const second = show(USE);\n  return first === second ? first : first + \" then \" + second;" },
  "in-a-loop": {
    body: `let all = "";
  for (let i = 0; i < 3; i++) {
    const point = new Point(round + i, i, "p" + (round + i));
    all = show(USE) + point.x;
    keep(point);
  }
  return all;`,
  },
  "in-a-handler": {
    body: `const before = new Point(round, 3, "p" + round);
  try {
    if (round >= 0) throw before;
    return "";
  } catch (thrown) {
    const answer = USE;
    keep(thrown as Point);
    return show(answer) + (thrown as Point).y + new Point(round, 4, "q").name;
  }`,
  },
  "in-a-closure": {
    body: `const before = new Point(round, 5, "p" + round);
  const run = () => show(USE) + before.y;
  keep(before);
  return [0].map(run)[0];`,
  },
  "behind-a-wait": {
    isAsync: true,
    body: `const before = new Point(round, 6, "p" + round);
  await null;
  const answer = USE;
  const behind = new Point(round + 2000, 7, "p" + (round + 2000));
  await null;
  keep(before);
  keep(behind);
  return show(answer) + before.y + behind.y;`,
  },
  "in-a-generator": {
    body: `function* steps(): Generator<string, void, unknown> {
    const before = new Point(round, 8, "p" + round);
    yield "";
    const answer = USE;
    yield show(answer) + before.y + new Point(round, 9, "q").y;
    keep(before);
  }
  return [...steps()].join("");`,
  },
};

// Where the pieces come from at the use. `MAKE` is the call of the maker.
const homes: Record<string, { before: string; read: string }> = {
  argument: { before: "", read: "text" },
  field: { before: "const home = new Holder(text, round);", read: "home.text" },
  element: { before: "const home: string[] = [\"\", text];", read: "home[1]" },
  map: { before: "const home = new Map<number, string>([[round, text]]);", read: "home.get(round)!" },
  closure: { before: "const home = ((held: string) => () => held)(text);", read: "home()" },
  "optional-field": { before: "const home: { text?: string } = round >= 0 ? { text } : {};", read: "(home.text ?? \"\")" },
};

const joints: [string, string][] = [
  ["plus", "long + long"],
  ["plus-nothing", 'full + ""'],
  ["plus-one", 'full + "a"'],
  ["one-plus", '"a" + full'],
  ["plus-number", "full + 7"],
  ["just-fits", 'long + half + half.length'],
  ["added-to", "(() => {\n      let s = long;\n      s += long;\n      return s;\n    })()"],
  ["template", "`${long}${long}`"],
  ["template-of-three", "`${half}${long}${half}`"],
  ["template-that-fits", "`${half}${long}`"],
  ["concat", "long.concat(long)"],
  ["concat-of-three", "half.concat(half, long)"],
  ["repeat", "long.repeat(2)"],
  ["repeat-many", '"ab".repeat(1073741824)'],
  ["pad-end", 'long.padEnd(2147483648, "x")'],
  ["pad-start", '"x".padStart(4294967295, long)'],
];

export type Point = { text: string; maker: string; use: string; around: string; home: string; size: number; rounds: number };
export const dimensions = { texts: textKinds.map(kind => kind.name), makers: Object.keys(makers), uses: uses.map(([name]) => name), arounds: Object.keys(arounds), homes: Object.keys(homes) };

/** One use of one text, as functions whose names end in `id`, and the statement that runs them. */
function sceneOf(id: number, point: Point): { text: string; call: string } {
  const kind = textKinds.find(each => each.name === point.text)!;
  const makerName = point.maker;
  const [, use, longest = 1 << 24] = uses.find(([name]) => name === point.use)!;
  const around = arounds[point.around];
  const home = homes[point.home];
  const size = kind.filler ? Math.min(point.size, longest) : 0;
  const fillers = size ? Math.ceil(size / kind.filler!.length / 16) : 0;
  const rounds = point.rounds;
  const at = kind.fillerAt ?? 1;
  const text = `const pieces${id}: string[] = JSON.parse(${JSON.stringify(JSON.stringify(kind.pieces))});
${fillers ? `{\n  const filler = flatTwin(${JSON.stringify(kind.filler)}.repeat(${fillers}));\n  pieces${id}.splice(${at}, 0, ...Array.from({ length: 16 }, () => filler));\n}\n` : ""}function make${id}(p: string[]): string {
  ${makers[makerName]}
}
${around.isAsync ? "async " : ""}function use${id}(text: string, round: number, holder: Holder): ${around.isAsync ? "Promise<string>" : "string"} {
  ${home.before}
  const s = ${home.read};
${/\b(many|loose)\b/.test(use) ? "  const many: string[] = [s, s];\n  const loose = many as any;\n" : ""}  ${around.body.replaceAll("USE", () => use)}
}
${around.isAsync ? "async " : ""}function scene${id}(): ${around.isAsync ? "Promise<void>" : "void"} {
  const holder = new Holder(flatTwin("held"), 7);
  for (let round = 0; round < ${rounds}; round++) {
    const answer = ${around.isAsync ? "await " : ""}use${id}(make${id}(pieces${id}), round, holder);
    const expected = ${around.isAsync ? "await " : ""}use${id}(flatTwin(make${id}(pieces${id})), round, holder);
    note("${id}", answer, expected);
  }
  checkKept("${id}");
}`;
  return { text, call: `${around.isAsync ? "await " : ""}scene${id}();` };
}

const ending = `console.log("wrong: " + [...wrong].sort().join(" ~ "));\nconsole.log("digest: " + digest);`;

/** A program of exactly these points, for a walk through the whole table. */
export function programOf(points: Point[]): string {
  const scenes = points.map((point, at) => sceneOf(at + 1, point));
  return [prelude, ...scenes.map(scene => scene.text), scenes.map(scene => scene.call).join("\n"), ending].join("\n");
}

export function generate(random: Random): string {
  const names: string[] = [];
  const text: string[] = [prelude];
  const calls: string[] = [];
  const scenes = random.between(4, 9);
  for (let id = 1; id <= scenes; id++) {
    if (random.chance(0.06)) {
      const chosen = random.sample(joints, random.between(2, 5));
      names.push("too-long--" + chosen.map(([name]) => name).join("-"));
      text.push(`function tooLong${id}(): void {
  let full = "";
  let long = flatTwin("a");
  let half = long;
  for (let i = 0; i < 31; i++) {
    full += long;
    if (i === 30) break;
    half = long;
    long += long;
  }
  let line = "${id} " + full.length + " " + long.length + " " + half.length;
${chosen
  .map(
    ([name, joint]) => `  try {
    const joined = ${joint};
    line += " ${name}: " + joined.length;
  } catch (error) {
    line += " ${name}: " + (error as Error).name + " " + (error as Error).message;
  }`,
  )
  .join("\n")}
  console.log(line);
}`);
      calls.push(`tooLong${id}();`);
      continue;
    }
    const kind = random.pick(textKinds);
    const size = kind.filler ? random.weighted([[5, 0], [3, 60], [3, 1500], [3, 40000], [4, 600000], [2, 3000000]] as const) : 0;
    const point: Point = {
      text: kind.name,
      maker: random.weighted(Object.keys(makers).map(name => [name === "flat" ? 1 : 4, name] as const)),
      use: random.pick(uses)[0],
      around: random.pick(Object.keys(arounds)),
      home: random.weighted(Object.keys(homes).map(name => [name === "argument" ? 4 : 1, name] as const)),
      size,
      rounds: size > 1000000 ? 12 : size > 100000 ? 40 : size > 10000 ? 60 : random.pick([3, 40, 150]),
    };
    names.push([point.text, point.maker, point.use, point.around, point.home, point.size].join("-"));
    const scene = sceneOf(id, point);
    text.push(scene.text);
    calls.push(scene.call);
  }
  text.push(calls.join("\n"));
  text.push(ending);
  return `// ${names.join(" ")}\n${text.join("\n")}`;
}
