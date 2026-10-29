// Two arms of a union differ only some levels below. A value that satisfies the second arm is taken, however deep the difference lies, by `JSON.parse(text) as T`.
type D1 = { a: { v: 1 }; n: number } | { a: { v: "s" }; n: number };
type D2 = { a: { b: { v: 1 } }; n: number } | { a: { b: { v: "s" } }; n: number };
type D3 = { a: { b: { c: { v: 1 } } }; n: number } | { a: { b: { c: { v: "s" } } }; n: number };
type D4 = { a: { b: { c: { d: { v: 1 } } } }; n: number } | { a: { b: { c: { d: { v: "s" } } } }; n: number };
type D5 = { a: { b: { c: { d: { e: { v: 1 } } } } }; n: number } | { a: { b: { c: { d: { e: { v: "s" } } } } }; n: number };
type D6 = { a: { b: { c: { d: { e: { f: { v: 1 } } } } } }; n: number } | { a: { b: { c: { d: { e: { f: { v: "s" } } } } } }; n: number };
type D7 = { a: { b: { c: { d: { e: { f: { g: { v: 1 } } } } } } }; n: number } | { a: { b: { c: { d: { e: { f: { g: { v: "s" } } } } } } }; n: number };
type D8 = { a: { b: { c: { d: { e: { f: { g: { h: { v: 1 } } } } } } } }; n: number } | { a: { b: { c: { d: { e: { f: { g: { h: { v: "s" } } } } } } } }; n: number };
type Kinds = { a: { b: { c: { d: { e: { v: number } } } } }; n: number } | { a: { b: { c: { d: { e: { v: string } } } } }; n: number } | { a: { b: { c: { d: { e: { w: boolean } } } } }; n: number };
type InLists = { a: { b: { c: { list: { d: { e: { v: 1 } } }[] } } }; n: number } | { a: { b: { c: { list: { d: { e: { v: "s" } } }[] } } }; n: number };
const names = "abcdefghij";
function textOf(levels: number, leaf: string): string {
  let text = leaf;
  for (let level = levels - 1; level > 0; level--) text = `{"${names[level]}":${text}}`;
  return `{"a":${text},"n":1}`;
}
function say(label: string, run: (text: string) => any, text: string): void {
  let said = "";
  try {
    const made = run(text);
    said = JSON.stringify(made).replace('"m":1', '"n":1') === text && (made.n ?? made.m) + 1 === 2 ? "taken" : "DIFFERENT";
  } catch (error: any) {
    said = error.name;
  }
  console.log(label + ": " + said);
}
function all(label: string, parse: (text: string) => any, texts: string[]): void {
  for (let round = 0; round < 2; round++) for (const text of texts) say(label + " " + text, parse, text);
}
all("1 below", text => JSON.parse(text) as D1, [textOf(1, '{"v":"s"}'), textOf(1, '{"v":1}'), textOf(1, '{"v":"s"}')]);
say("1 below, neither", text => JSON.parse(text) as D1, textOf(1, '{"v":2}'));
all("2 below", text => JSON.parse(text) as D2, [textOf(2, '{"v":"s"}'), textOf(2, '{"v":1}'), textOf(2, '{"v":"s"}')]);
say("2 below, neither", text => JSON.parse(text) as D2, textOf(2, '{"v":2}'));
all("3 below", text => JSON.parse(text) as D3, [textOf(3, '{"v":"s"}'), textOf(3, '{"v":1}'), textOf(3, '{"v":"s"}')]);
say("3 below, neither", text => JSON.parse(text) as D3, textOf(3, '{"v":2}'));
all("4 below", text => JSON.parse(text) as D4, [textOf(4, '{"v":"s"}'), textOf(4, '{"v":1}'), textOf(4, '{"v":"s"}')]);
say("4 below, neither", text => JSON.parse(text) as D4, textOf(4, '{"v":2}'));
all("5 below", text => JSON.parse(text) as D5, [textOf(5, '{"v":"s"}'), textOf(5, '{"v":1}'), textOf(5, '{"v":"s"}')]);
say("5 below, neither", text => JSON.parse(text) as D5, textOf(5, '{"v":2}'));
all("6 below", text => JSON.parse(text) as D6, [textOf(6, '{"v":"s"}'), textOf(6, '{"v":1}'), textOf(6, '{"v":"s"}')]);
say("6 below, neither", text => JSON.parse(text) as D6, textOf(6, '{"v":2}'));
all("7 below", text => JSON.parse(text) as D7, [textOf(7, '{"v":"s"}'), textOf(7, '{"v":1}'), textOf(7, '{"v":"s"}')]);
say("7 below, neither", text => JSON.parse(text) as D7, textOf(7, '{"v":2}'));
all("8 below", text => JSON.parse(text) as D8, [textOf(8, '{"v":"s"}'), textOf(8, '{"v":1}'), textOf(8, '{"v":"s"}')]);
say("8 below, neither", text => JSON.parse(text) as D8, textOf(8, '{"v":2}'));
all("three kinds", text => JSON.parse(text) as Kinds, [textOf(5, '{"w":true}'), textOf(5, '{"v":"s"}'), textOf(5, '{"v":1.5}')]);
const list = (leaves: string[]) => textOf(3, '{"list":[' + leaves.map(leaf => '{"d":{"e":' + leaf + "}}").join(",") + "]}");
all("within lists", text => JSON.parse(text) as InLists, [list(['{"v":"s"}']), list(['{"v":1}', '{"v":1}']), list(['{"v":"s"}', '{"v":"s"}', '{"v":"s"}']), list([])]);
say("within lists, both kinds in one", text => JSON.parse(text) as InLists, list(['{"v":1}', '{"v":"s"}']));
const several = "[" + [textOf(6, '{"v":"s"}'), textOf(6, '{"v":1}'), textOf(6, '{"v":"s"}'), textOf(6, '{"v":1}')].join(",") + "]";
for (const [label, run] of [["parsed", (text: string) => JSON.parse(text) as D6[]]] as const) {
  try {
    console.log("both arms in turn in a list, " + label + ": " + (JSON.stringify(run(several)).replaceAll('"m":1', '"n":1') === several ? "taken" : "DIFFERENT"));
  } catch (error: any) {
    console.log("both arms in turn in a list, " + label + ": " + error.name);
  }
}
function read(value: D5): string {
  const leaf = value.a.b.c.d.e.v;
  return typeof leaf === "string" ? "text " + leaf : "number " + (leaf + 1);
}
for (const run of [() => read(JSON.parse(textOf(5, '{"v":"s"}')) as D5), () => read(JSON.parse(textOf(5, '{"v":1}')) as D5)]) {
  try {
    console.log(run());
  } catch (error: any) {
    console.log(error.name);
  }
}
