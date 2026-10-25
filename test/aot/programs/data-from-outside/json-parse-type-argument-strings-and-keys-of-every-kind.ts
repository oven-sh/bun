// Strings and keys of every kind: escapes that are valid and not, lone surrogates written raw and escaped, control characters, keys written twice, __proto__, index keys, the empty key, in 8-bit and 16-bit text.
const plainParse: (text: string) => any = globalThis.JSON.parse;

function show(value: any): string {
  if (Array.isArray(value)) return "[" + value.map(show).join(",") + "]";
  if (typeof value === "string") return JSON.stringify(value) + value.length;
  if (typeof value !== "object" || value === null) return Object.is(value, -0) ? "-0" : typeof value + ":" + String(value);
  return "{" + Object.getOwnPropertyNames(value).map(key => JSON.stringify(key) + ":" + show(value[key])).join(",") + "}" + (Object.getPrototypeOf(value) === Object.prototype ? "" : "!");
}

function outcome(parse: (text: string) => unknown, text: string): string {
  try {
    return show(parse(text));
  } catch (error: any) {
    return error.name + ": " + error.message;
  }
}

let shown = 0;
function differs(parse: (text: string) => unknown, text: string): number {
  const typed = outcome(parse, text);
  const plain = outcome(plainParse, text);
  if (typed === plain) return 0;
  if (shown++ < 12) console.log("DIFFERENT on " + JSON.stringify(text).slice(0, 300) + "\n  typed: " + typed.slice(0, 300) + "\n  plain: " + plain.slice(0, 300));
  return 1;
}

type Held = { s: string };
type Either = { s: string | number };
type Word = { s: "a" | "b" | "é" | "a\nb" | "" | "\ud83d\ude00" };
type Odd = { "": number; "0": number; "a b": number; "é": number; "日本": number; "a\"b": number; "a\\b": number; "a\nb": number; constructor: number; toString: number; "1.5": number; "-1": number; "01": number; length: number; then: number };
type Point = { x: number; y: number };
type Optional = { x?: number; y?: number; z?: string };
type Tagged = { kind: "a"; a: number } | { kind: "b"; b: number };

const stringRoads: [string, (text: string) => unknown, (string: string) => string][] = [
  ["a member", text => JSON.parse(text) as Held, string => '{"s":' + string + "}"],
  ["a union", text => JSON.parse(text) as Either, string => '{"s":' + string + "}"],
  ["constants", text => JSON.parse(text) as Word, string => '{"s":' + string + "}"],
  ["the root", text => JSON.parse(text) as string, string => string],
  ["elements", text => JSON.parse(text) as string[], string => "[" + string + "," + string + "]"],
  ["a tuple", text => JSON.parse(text) as [string, string], string => "[" + string + "," + string + "]"],
  ["values of a dictionary", text => JSON.parse(text) as Record<string, string>, string => '{"k":' + string + "}"],
  ["keys of a dictionary", text => JSON.parse(text) as Record<string, number>, string => "{" + string + ":1," + string + ":2}"],
  ["an undeclared key", text => JSON.parse(text) as Point, string => '{"x":1,' + string + ':3,"y":2}'],
  ["an undeclared value", text => JSON.parse(text) as Point, string => '{"x":1,"u":' + string + ',"y":2}'],
  ["under unknown", text => JSON.parse(text) as { u: unknown }, string => '{"u":[' + string + ",{" + string + ":" + string + "}]}"],
];

const pieces = [
  "", "a", "b", "ab", "é", "\u00ff", "\u0100", "日本", "\ud83d\ude00", "\ud800", "\udc00", "\udc00\ud800", "\ud800a", "a\udc00", "\u2028", "\u2029", "\ufeff", "\ufffe", "\uffff", "\u007f", "\u0080", "\u009f", "\u00a0", "/",
  "\\n", "\\r", "\\t", "\\b", "\\f", "\\/", "\\\\", '\\"', "\\u0000", "\\u0001", "\\u001f", "\\u0020", "\\u0022", "\\u005c", "\\u0061", "\\u00e9", "\\u00E9", "\\u00ff", "\\u0100", "\\u2028", "\\uD83D\\uDE00", "\\ud83d\\ude00", "\\ud800", "\\udc00", "\\udc00\\ud800",
  "\\ud800a", "\\ud800\\n", "\\ud83d\ude00", "\ud83d\\ude00", "\\uffff", "\\uFFFF",
  "\\", "\\u", "\\u0", "\\u00", "\\u006", "\\u006g", "\\uzzzz", "\\U0061", "\\x61", "\\a", "\\0", "\\'", "\\ ", "\\\n", "\\u 061", "\\u+061", "\\u-061", "\\u00\u0661", "\\\u0100", "\\é",
  "\u0000", "\u0001", "\u0008", "\t", "\n", "\r", "\u001f", "'", "`", "${a}", "__proto__", "constructor", "0", "1", "42", "4294967294", "4294967295", "-1", "01", "1.5", "x", "y", "s", "kind",
];
const fillers = ["", "p", "0123456789abcde", "0123456789abcdef", "0123456789abcdef0123456789abcde", "0123456789abcdef0123456789abcdef", "x".repeat(63), "x".repeat(64), "x".repeat(65), "x".repeat(200), "é".repeat(40), "日".repeat(40)];

for (const [label, parse, wrap] of stringRoads) {
  let different = 0;
  let texts = 0;
  for (const piece of pieces) {
    for (const filler of fillers) {
      different += differs(parse, wrap('"' + filler + piece + '"')) + differs(parse, wrap('"' + piece + filler + '"')) + differs(parse, wrap('"' + filler + piece + filler + piece + '"'));
      texts += 3;
    }
    different += differs(parse, wrap('"' + piece)) + differs(parse, wrap(piece + '"')) + differs(parse, wrap(piece)) + differs(parse, wrap("'" + piece + "'"));
    texts += 4;
  }
  console.log(label + ": " + texts + " texts: " + different + " differ");
}

const oddMembers = ['"":1', '"0":2', '"a b":3', '"é":4', '"日本":5', '"a\\"b":6', '"a\\\\b":7', '"a\\nb":8', '"constructor":9', '"toString":10', '"1.5":11', '"-1":12', '"01":13', '"length":14', '"then":15'];
const keyTexts = [
  "{" + oddMembers.join(",") + "}",
  "{" + [...oddMembers].reverse().join(",") + "}",
  "{" + oddMembers.join(",") + ',"__proto__":16,"1":17,"valueOf":18}',
  "{" + oddMembers.join(",").replace('"é"', '"\\u00e9"').replace('"a b"', '"a\\u0020b"') + "}",
  "{" + oddMembers.join(",") + "," + oddMembers.join(",").replace(/:/g, ":1") + "}",
  "{" + oddMembers.slice(1).join(",") + "}",
];
{
  let different = 0;
  for (const text of keyTexts) different += differs(text => JSON.parse(text) as Odd, text) + differs(text => JSON.parse(text) as Odd[], "[" + text + "," + text + "]") + differs(text => JSON.parse(text) as Odd, (text + "\u0100").slice(0, -1));
  console.log("declared keys of every kind: " + keyTexts.length * 3 + " texts: " + different + " differ");
}

const keys = ['"x"', '"y"', '"z"', '"\\u0078"', '"\\u0079"', '"x\\u0000"', '"x "', '" x"', '"X"', '"xx"', '""', '"__proto__"', '"\\u005f_proto__"', '"constructor"', '"toString"', '"hasOwnProperty"', '"0"', '"1"', '"00"', '"-0"', '"4294967294"', '"4294967295"', '"kind"', '"a"', '"b"', '"\u0100"', '"é"'];
const values = ["1", "2.5", '"t"', "null", "{}", "[]", '{"x":1,"y":2}', '{"__proto__":{"x":1}}', '"a"', '"b"', "true"];
const keyRoads: [string, (text: string) => unknown][] = [
  ["two required members", text => JSON.parse(text) as Point],
  ["optional members", text => JSON.parse(text) as Optional],
  ["a tagged union", text => JSON.parse(text) as Tagged],
  ["a dictionary of numbers", text => JSON.parse(text) as Record<string, number>],
  ["a dictionary of records", text => JSON.parse(text) as Record<string, Point>],
  ["members beside an index signature", text => JSON.parse(text) as { x: number; [key: string]: number | string }],
];
for (const [label, parse] of keyRoads) {
  let different = 0;
  let texts = 0;
  for (const first of keys) {
    for (const second of keys) {
      for (let at = 0; at < values.length; at++) {
        const value = values[at];
        const other = values[(at + 3) % values.length];
        different += differs(parse, "{" + first + ":" + value + "," + second + ":" + other + "}");
        different += differs(parse, '{"x":1,' + first + ":" + value + ',"y":2,' + second + ":" + other + "}");
        different += differs(parse, "{" + first + ":" + value + ',"kind":"a",' + second + ":" + other + ',"a":1,"x":3,"y":4}');
        texts += 3;
      }
    }
  }
  console.log(label + ": " + texts + " texts: " + different + " differ");
}
