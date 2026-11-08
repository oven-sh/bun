// `JSON.parse(text) as T` through one parse site for each declared type, with every sequence of up to three members out of twenty-two
// member texts: right and wrong kinds of value, numbers in many spellings, escapes in values and in keys, a member twice, members that
// T does not declare, "__proto__", an index, null, nested things. Also texts that are cut short or hold junk.
// Seen: each declared member read by its name, the keys in their order, JSON.stringify, `in`, and the words of an error.

const members = [
  `"a":1`,
  `"a":1.5`,
  `"a":-0`,
  `"a":1e3`,
  `"a":12345678901234567890`,
  `"a":"x"`,
  `"a":null`,
  `"a":[1,2]`,
  `"a":{"a":1}`,
  `"a":true`,
  `"b":"s"`,
  `"b":"\\u0041\\n\\"q\\ud83d\\ude00"`,
  `"b":""`,
  `"b":2`,
  `"b":{"a":2}`,
  `"c":true`,
  `"c":0`,
  `"d":9`,
  `"__proto__":{"z":1}`,
  `"0":1`,
  `"\\u0061":7`,
  `"b" : [ ]`,
];
const broken = [
  ``,
  ` `,
  `{`,
  `{"a"`,
  `{"a":`,
  `{"a":1`,
  `{"a":1,`,
  `{"a":1,}`,
  `{"a":1}}`,
  `{"a":1} x`,
  `{a:1}`,
  `{'a':1}`,
  `{"a":01}`,
  `{"a":1.}`,
  `{"a":.5}`,
  `{"a":+1}`,
  `{"a":1e}`,
  `{"a":0x1}`,
  `{"a":NaN}`,
  `{"a":undefined}`,
  `{"a":"\\x"}`,
  `{"a":"\\u12"}`,
  `{"a":"\n"}`,
  `{"a":"unterminated`,
  `{"a":tru}`,
  `{"a":nul}`,
  `[`,
  `[1,`,
  `[1,]`,
  `[1 2]`,
  `null`,
  `true`,
  `1`,
  `"text"`,
  `[]`,
  `[{}]`,
  ` \t\r\n{ "a" : 1 , "b" : "s" } \n`,
  `﻿{"a":1}`,
  `{"a":1,"b":"s","c":true,"a":2,"b":"t","c":false}`,
];

function objects() {
  const all = [`{}`];
  for (const x of members) {
    all.push(`{${x}}`);
    for (const y of members) {
      all.push(`{${x},${y}}`);
      for (const z of members) all.push(`{${x},${y},${z}}`);
    }
  }
  return all;
}

const upToTwo = () => objects().filter(text => text.split(`,"`).length <= 2);

export function programs(): { name: string; text: string }[] {
  const every = [...objects(), ...broken];
  const short = upToTwo();
  const lists = [
    ...short.map(object => `[${object}]`),
    ...short.slice(0, 200).flatMap(first => short.slice(0, 24).map(second => `[${first},${second}]`)),
    ...broken,
  ];
  const types: Record<string, [type: string, texts: string[]]> = {
    record: [`{ a: number; b: string; c?: boolean }`, every],
    nested: [`{ a: number[]; b: { a: number } }`, every],
    either: [`{ a: number | null; b?: string | number }`, every],
    list: [`{ a: number; b: string }[]`, lists],
    table: [`Record<string, number>`, every],
    union: [`{ a: number; b: string } | { a: string; c: boolean }`, every],
  };
  return Object.entries(types).map(([name, [type, texts]]) => ({
    name,
    text: `type T = ${type};
type Each = ${name === "list" ? "T[number]" : "T"};
const texts: string[] = ${JSON.stringify(texts)};
const text = (v: unknown): string => Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
function seen(v: Each): string {
  const all = v as any;
  return typeof all.a + " " + text(all.a) + " " + typeof all.b + " " + text(all.b) + " " + typeof all.c + " " + text(all.c) + " " + ("a" in all) + ("d" in all) + ("z" in all) + " " + Object.keys(all).join() + " " + JSON.stringify(v);
}
const show = ${
      name === "list"
        ? `(v: any) => Array.isArray(v) ? "[" + (v as T).map(each => each === null || typeof each !== "object" ? String(each) : seen(each)).join(";") + "]" : String(v)`
        : `(v: any) => v === null || typeof v !== "object" ? typeof v + " " + String(v) : seen(v as T)`
    };
function parse(source: string): T { return JSON.parse(source) as T; }
let printed = "";
for (let i = 0; i < texts.length; i++) {
  let line: string;
  try { line = show(parse(texts[i])); } catch (e: any) { line = "threw " + e.name + ": " + e.message; }
  printed += i + " " + JSON.stringify(texts[i]) + " : " + line.replaceAll("\\n", "\\\\n") + "\\n";
}
await new Promise<void>(done => { process.stdout.write(printed, () => done()); });
export {};
`,
  }));
}
