export function describe(value: unknown, depth: number): string {
  if (value === null) return "null";
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : "n" + String(value);
  if (typeof value === "string") {
    let out = "s";
    for (let i = 0; i < value.length && i < 40; i++) out += value.charCodeAt(i).toString(36) + ".";
    return out + value.length;
  }
  if (typeof value !== "object") return typeof value + ":" + String(value);
  if (depth > 12) return "deep";
  if (Array.isArray(value)) {
    let out = Object.getPrototypeOf(value) === Array.prototype ? "[" : "[!prototype ";
    for (let i = 0; i < value.length && i < 50; i++) out += describe(value[i], depth + 1) + ",";
    return out + "]" + value.length + (Object.keys(value).length === value.length ? "" : "!keys");
  }
  let out = Object.getPrototypeOf(value) === Object.prototype ? "{" : "{!prototype ";
  for (const key of Reflect.ownKeys(value as object)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    out += String(key) + (descriptor.writable && descriptor.enumerable && descriptor.configurable ? ":" : "!attributes:") + describe(descriptor.value, depth + 1) + ",";
  }
  let listed = "";
  for (const key in value as object) listed += key + ",";
  return out + "}" + (listed === Object.keys(value as object).join(",") + (listed === "" ? "" : ",") ? "" : "!for-in " + listed);
}

type Member = [string, string];
function join(members: Member[], open: string, colon: string, comma: string, close: string): string {
  return open + members.map(member => member[0] + colon + member[1]).join(comma) + close;
}
function compact(members: Member[]): string {
  return join(members, "{", ":", ",", "}");
}

const bases: Member[][] = [
  [
    ['"id"', "1"],
    ['"name"', '"n"'],
    ['"ok"', "true"],
    ['"note"', "null"],
  ],
  [
    ['"a"', "1"],
    ['"b"', '"x"'],
    ['"c"', "2.5"],
    ['"d"', "false"],
    ['"e"', "[1,2]"],
  ],
  [
    ['"first"', "1"],
    ['"second"', '"s"'],
  ],
  [
    ['"p"', "1"],
    ['"q"', "2"],
    ['"r"', "3"],
    ['"s"', "4"],
    ['"t"', "5"],
    ['"u"', "6"],
    ['"v"', "7"],
    ['"w"', "8"],
    ['"x"', "9"],
    ['"y"', "10"],
  ],
  [
    ['"id"', "7"],
    ['"items"', '[{"sku":"a","quantity":1},{"sku":"b","quantity":2}]'],
    ['"tags"', '["t","u"]'],
    ['"owner"', '{"name":"o","age":30}'],
  ],
  [
    ['"value"', "1"],
    ['"next"', '{"value":2,"next":{"value":3,"next":null}}'],
  ],
  [
    ['"label"', '"root"'],
    ['"children"', '[{"label":"a","children":[]},{"label":"b","children":[{"label":"c","children":[]}]}]'],
  ],
  [
    ['"kind"', '"circle"'],
    ['"radius"', "2"],
  ],
  [
    ['"kind"', '"square"'],
    ['"side"', "3"],
  ],
  [['"kind"', '"dot"']],
  [
    ['"color"', "1"],
    ['"level"', '"high"'],
    ['"mode"', '"off"'],
    ['"zero"', "0"],
    ['"flag"', "true"],
    ['"nothing"', "null"],
  ],
  [
    ['"anything"', '{"z":1,"a":[2,{"b":3}]}'],
    ['"unknown"', "[null]"],
    ['"object"', "{}"],
  ],
  [
    ['"id"', "1"],
    ['"more"', "2"],
    ['"0"', "3"],
  ],
  [
    ['"id"', "1"],
    ['"when"', '"2020-01-01T00:00:00.000Z"'],
  ],
  [
    ['"constructor"', "1"],
    ['"toString"', '"s"'],
  ],
  [
    ['"id"', "1"],
    ['"list"', "[1,2,3]"],
  ],
  [
    ['"x"', "1"],
    ['"y"', "2"],
  ],
  [['"id"', '"id-5"']],
  [
    ['"left"', "1"],
    ['"right"', '"r"'],
  ],
];

const otherValues = [
  "null",
  "true",
  "false",
  "0",
  "-0",
  "-0.0",
  "0e0",
  "1",
  "-1",
  "1.5",
  "1.0",
  "1e2",
  "1E+2",
  "100e-2",
  "2147483647",
  "2147483648",
  "-2147483648",
  "-2147483649",
  "4294967296",
  "9007199254740991",
  "9007199254740992",
  "9007199254740993",
  "123456789012345678901234567890",
  "0.1",
  "0.30000000000000004",
  "5e-324",
  "2e-324",
  "1.7976931348623157e308",
  "1e309",
  "-1e309",
  "1e-400",
  '""',
  '"s"',
  '"1"',
  '"null"',
  '"\\n\\t\\"\\\\\\/\\b\\f\\r"',
  '"\\u0000"',
  '"\\u0041"',
  '"\\ud800"',
  '"\\udc00x"',
  '"\\ud83d\\ude00"',
  '"é"',
  '"中文"',
  '"😀"',
  '"  "',
  '"\u007f"',
  '"circle"',
  '"on"',
  '"low"',
  '"id-"',
  '"id-1e3"',
  "[]",
  "[1]",
  "[[]]",
  '["a"]',
  "[null]",
  "[{}]",
  "{}",
  '{"a":1}',
  '{"id":1}',
  '{"length":0}',
  '{"__proto__":null}',
  '{"__proto__":{"polluted":true}}',
];

const malformedValues = [
  "",
  " ",
  "01",
  "-",
  "+1",
  ".5",
  "1.",
  "1e",
  "1e+",
  "0x10",
  "1_000",
  "NaN",
  "Infinity",
  "-Infinity",
  "undefined",
  "nul",
  "nulll",
  "True",
  "tru",
  "'s'",
  '"',
  '"\\"',
  '"\\x41"',
  '"\\u12"',
  '"\\u12g4"',
  '"\n"',
  '"\t"',
  '"\u0000"',
  '"\u001f"',
  "[",
  "]",
  "[1,]",
  "[,1]",
  "[1 2]",
  "[1,,2]",
  "{",
  "}",
  '{"a"}',
  '{"a":}',
  '{"a":1,}',
  '{,"a":1}',
  "{a:1}",
  "{'a':1}",
  '{"a":1 "b":2}',
  '{"a"::1}',
  "/**/1",
  "1//",
  "1n",
];

const extraKeys = ['"extra"', '"__proto__"', '"constructor"', '"toString"', '"hasOwnProperty"', '"0"', '"1"', '"-1"', '"1e3"', '"4294967295"', '"4294967294"', '""', '" "', '"a b"', '"\\u0065xtra"', '"é"', '"中"', '"length"', '"then"'];

function escapeFirstCharacter(key: string): string {
  return '"\\u' + key.charCodeAt(1).toString(16).padStart(4, "0") + key.slice(2);
}

export const texts: string[] = [];
for (const base of bases) {
  texts.push(compact(base));
  texts.push(join(base, "{ ", ": ", ", ", " }"));
  texts.push(join(base, "{", ": ", ",", "}"));
  texts.push(join(base, "{", " :", " ,", "}"));
  texts.push(join(base, "{\n  ", ": ", ",\n  ", "\n}"));
  texts.push(join(base, "{\r\n\t", ":\t", ",\r\n\t", "\r\n}"));
  texts.push(" \t\r\n" + compact(base) + " \t\r\n");
  texts.push(join(base, "{\f", ":", ",", "}"));
  texts.push(join(base, "{", ":\v", ",", "}"));
  texts.push(join(base, "{", ":", ", ", "}"));
  texts.push("﻿" + compact(base));
  texts.push(compact(base) + "﻿");
  texts.push(compact(base) + "x");
  texts.push(compact(base) + compact(base));
  texts.push(compact(base) + ",");
  texts.push(compact(base) + "\u0000");
  texts.push("[" + compact(base) + "]");
  texts.push("[" + compact(base) + "," + compact(base) + "]");
  texts.push("[ " + compact(base) + " , " + compact(base) + " ]");
  texts.push("[[" + compact(base) + "],[]]");
  texts.push("[" + compact(base) + ",null]");
  texts.push("[" + compact(base) + ",1]");
  texts.push('{"k":' + compact(base) + ',"__proto__":' + compact(base) + ',"0":' + compact(base) + "}");
  texts.push(compact([...base].reverse()));
  texts.push(join([...base].reverse(), "{ ", " : ", " , ", " }"));
  for (let at = 0; at < base.length; at++) {
    const without = base.filter((_, index) => index !== at);
    texts.push(compact(without));
    texts.push(join(without, "{ ", ": ", ", ", " }"));
    texts.push(compact([...without, base[at]!]));
    texts.push(compact([base[at]!, ...without]));
    texts.push(compact([...base, base[at]!]));
    texts.push(compact([...base.slice(0, at + 1), base[at]!, ...base.slice(at + 1)]));
    texts.push(compact([...base, [base[at]![0], '"other"']]));
    texts.push(compact([[base[at]![0], "[0]"], ...base]));
    texts.push(compact(base.map((member, index): Member => (index === at ? [escapeFirstCharacter(member[0]), member[1]] : member))));
    for (const value of otherValues) texts.push(compact(base.map((member, index): Member => (index === at ? [member[0], value] : member))));
    for (const value of malformedValues) texts.push(compact(base.map((member, index): Member => (index === at ? [member[0], value] : member))));
    for (const key of extraKeys) texts.push(compact([...base.slice(0, at), [key, "1"], ...base.slice(at)]));
  }
  for (const key of extraKeys) {
    texts.push(compact([...base, [key, "1"]]));
    texts.push(compact([...base, [key, '{"a":[1]}']]));
    texts.push(join([...base, [key, "null"]], "{ ", ": ", ", ", " }"));
  }
  const whole = compact(base);
  for (let length = 0; length < whole.length; length++) texts.push(whole.slice(0, length));
}
for (const value of otherValues) texts.push(value, " " + value + " ", "[" + value + "]", "[" + value + "," + value + "]", "[1," + value + "]", '[1,"a",' + value + "]");
for (const value of malformedValues) texts.push(value, "[" + value + "]", "[1," + value + "]");

let nested = "null";
for (let depth = 0; depth < 3000; depth++) nested = '{"value":' + depth + ',"next":' + nested + "}";
texts.push(nested);
let branches = '{"label":"leaf","children":[]}';
for (let depth = 0; depth < 3000; depth++) branches = '{"label":"' + depth + '","children":[' + branches + "]}";
texts.push(branches);
texts.push("[".repeat(3000) + "]".repeat(3000));
texts.push("[".repeat(3000));
const many: string[] = [];
for (let index = 0; index < 5000; index++) many.push('{"id":' + index + ',"name":"n' + (index % 17) + '","ok":' + (index % 2 === 0) + ',"note":' + (index % 3 === 0 ? "null" : '"x"') + "}");
texts.push("[" + many.join(",") + "]");
texts.push("[" + many.join(",") + ',{"id":"last"}]');
texts.push('"' + "a".repeat(100000) + '"');
texts.push('{"id":1,"name":"' + "中".repeat(5000) + '","ok":true,"note":"' + "b".repeat(70000) + '"}');

function mix(hash: number, text: string): number {
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  return hash;
}

const isVerbose = false;
export function parseEveryText(sites: [string, (text: string) => unknown][]) {
  for (const [name, parse] of sites) {
    let hash = 0;
    let thrown = 0;
    for (let at = 0; at < texts.length; at++) {
      let line: string;
      try {
        const value = parse(texts[at]!);
        line = describe(value, 0) + " " + mix(0, JSON.stringify(value) ?? "undefined");
      } catch (error) {
        thrown++;
        line = "threw " + (error as Error).name + ": " + (error as Error).message;
      }
      if (isVerbose) console.log(name, at, line.slice(0, 300));
      hash = mix(hash, line);
    }
    console.log(name, texts.length, "texts,", thrown, "thrown,", hash);
  }
}
