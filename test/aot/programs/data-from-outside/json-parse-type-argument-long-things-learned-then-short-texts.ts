// Long keys, tags, constants and strings are learned by every table of the parsers; then short texts that begin alike, and every cut of the long ones, are parsed: nothing may be read behind the text.
type Point = { x: number; y: number };
type LongKeys = { aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: number; aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab: number; aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: number; aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?: number; short: number };
type LongConstant = { level: "llllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllll" | "lllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllm" | "lllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllll"; n: number };
type LongTags = { kind: "llllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllll"; a: number } | { kind: "lllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllm"; b: number } | { kind: "lllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllll"; c: number };
type Words = { words: string[] };

const plainParse: (text: string) => any = JSON.parse;
let different = 0;
let texts = 0;
function ask(parse: (text: string) => unknown, text: string): void {
  texts++;
  let typed = "";
  let plain = "";
  try {
    typed = JSON.stringify(parse(text));
  } catch (error: any) {
    typed = error.name === "TypeError" && error.issues?.length > 0 ? "refused" : error.name + ": " + error.message;
  }
  try {
    plain = JSON.stringify(plainParse(text));
  } catch (error: any) {
    plain = error.name + ": " + error.message;
  }
  if (typed !== plain && !(typed === "refused" && !plain.startsWith("SyntaxError"))) {
    if (different++ < 10) console.log("DIFFERENT on " + text.slice(0, 200) + "\n  " + typed.slice(0, 200) + "\n  " + plain.slice(0, 200));
  }
}
function told(label: string): void {
  console.log(label + ": " + texts + " texts: " + different + " differ");
  texts = 0;
  different = 0;
}
const lengths = [1, 2, 3, 5, 6, 7, 8, 9, 10, 14, 15, 16, 17, 22, 23, 24, 25, 30, 31, 32, 33, 34, 46, 47, 48, 49, 50, 51, 52, 54, 55, 56, 57, 58, 60, 61, 62, 63, 64, 65, 66, 70, 71, 72, 73, 100, 127, 128, 129, 200, 255, 256, 257, 300, 1000, 5000, 70000];
const annotated = (text: string): unknown => {
  const point: Point = JSON.parse(text);
  return point;
};
const cast = (text: string): unknown => JSON.parse(text) as Point;

const roads: [string, (text: string) => unknown, (long: string) => string][] = [
  ["an undeclared key behind", text => JSON.parse<Point>(text), long => '{"x":1,"y":2,"' + long + '":1}'],
  ["an undeclared key in front", text => JSON.parse<Point>(text), long => '{"' + long + '":1,"x":1,"y":2}'],
  ["two undeclared keys", text => JSON.parse<Point>(text), long => '{"x":1,"' + long + '":1,"y":2,"' + long + 'b":"' + long + '"}'],
  ["a key of a dictionary", text => JSON.parse<Record<string, number>>(text), long => '{"' + long + '":1,"' + long + 'b":2}'],
  ["a string", text => JSON.parse<Words>(text), long => '{"words":["' + long + '","' + long + '"]}'],
  ["an undeclared string", text => JSON.parse<Point>(text), long => '{"x":1,"y":2,"u":"' + long + '"}'],
  ["under unknown", text => JSON.parse<{ v: unknown }>(text), long => '{"v":{"' + long + '":"' + long + '"}}'],
  ["no type", plainParse, long => '{"x":1,"y":2,"' + long + '":"' + long + '"}'],
  ["an annotated variable", annotated, long => '{"x":1,"y":2,"' + long + '":"' + long + '"}'],
  ["a cast", cast, long => '{"x":1,"' + long + '":1,"y":2}'],
];
const only = Number((globalThis as any).arguments?.[0] ?? -1);
for (const [label, parse, wrap] of roads) {
  if (only >= 0 && roads[only]?.[0] !== label) continue;
  for (const character of ["k", "\u00e9"]) {
    for (const length of lengths) {
      const long = wrap(character.repeat(length));
      for (let round = 0; round < 20; round++) parse(long);
      for (const shorter of lengths) {
        if (shorter >= length) break;
        const short = wrap(character.repeat(shorter));
        ask(parse, short);
        ask(parse, short.slice(0, -1));
        ask(parse, short.slice(0, short.lastIndexOf('"')));
        ask(parse, short.slice(0, short.lastIndexOf('"') + 1));
        ask(parse, (short + "\u0100").slice(0, -1));
        parse(long);
      }
      if (length <= 300) for (let cut = long.length; cut > 0; cut--) ask(parse, long.slice(0, cut));
    }
  }
  told(label);
}

if (only < 0 || only === 10) {
const declared = ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "short"];
const whole = "{" + declared.map((name, at) => '"' + name + '":' + at).join(",") + "}";
for (let round = 0; round < 20; round++) JSON.parse<LongKeys>(whole);
for (let cut = whole.length; cut >= 0; cut--) ask(text => JSON.parse<LongKeys>(text), whole.slice(0, cut));
for (const name of declared) for (let cut = name.length; cut >= 0; cut--) for (const tail of ['":1}', '":1', '"', "", 'x":1}']) ask(text => JSON.parse<LongKeys>(text), '{"' + name.slice(0, cut) + tail);
for (const name of declared) for (let cut = name.length; cut >= 0; cut--) ask(text => JSON.parse<LongKeys>(text), '{"short":1,"' + name.slice(0, cut) + '":2,"' + name.slice(0, cut));
told("long declared keys");
}

const levels = ["llllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllll", "lllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllm", "lllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllll"];
if (only < 0 || only === 11) {
for (const level of levels) {
  for (let round = 0; round < 20; round++) JSON.parse<LongConstant>('{"level":"' + level + '","n":1}');
  for (let cut = level.length; cut >= 0; cut--) for (const tail of ['","n":1}', '"', "", 'x","n":1}', "\\"]) ask(text => JSON.parse<LongConstant>(text), '{"level":"' + level.slice(0, cut) + tail);
  for (let cut = level.length; cut >= 0; cut--) ask(text => JSON.parse<LongConstant>(text), '{"n":1,"level":"' + level.slice(0, cut));
}
told("long constants");
}
if (only < 0 || only === 12) {
for (const [tag, member] of [[levels[0], "a"], [levels[1], "b"], [levels[2], "c"]]) {
  for (let round = 0; round < 20; round++) JSON.parse<LongTags>('{"kind":"' + tag + '","' + member + '":1}');
  for (let cut = tag.length; cut >= 0; cut--) for (const tail of ['","' + member + '":1}', '"', "", "\\"]) {
    ask(text => JSON.parse<LongTags>(text), '{"kind":"' + tag.slice(0, cut) + tail);
    ask(text => JSON.parse<LongTags>(text), '{"' + member + '":1,"kind":"' + tag.slice(0, cut) + tail);
  }
}
told("long tags");
}
