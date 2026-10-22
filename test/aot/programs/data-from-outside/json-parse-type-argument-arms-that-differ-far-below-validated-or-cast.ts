// Two arms of a union differ only some levels below. A value that satisfies the second arm is taken, however deep the difference lies, by validate<T> and by `as T` as by JSON.parse<T>. (The program beside this one only parses.)
import { validate } from "bun:bundle";
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
type CastD1 = { a: { v: 1 }; m: number } | { a: { v: "s" }; m: number };
type CastD2 = { a: { b: { v: 1 } }; m: number } | { a: { b: { v: "s" } }; m: number };
type CastD3 = { a: { b: { c: { v: 1 } } }; m: number } | { a: { b: { c: { v: "s" } } }; m: number };
type CastD4 = { a: { b: { c: { d: { v: 1 } } } }; m: number } | { a: { b: { c: { d: { v: "s" } } } }; m: number };
type CastD5 = { a: { b: { c: { d: { e: { v: 1 } } } } }; m: number } | { a: { b: { c: { d: { e: { v: "s" } } } } }; m: number };
type CastD6 = { a: { b: { c: { d: { e: { f: { v: 1 } } } } } }; m: number } | { a: { b: { c: { d: { e: { f: { v: "s" } } } } } }; m: number };
type CastD7 = { a: { b: { c: { d: { e: { f: { g: { v: 1 } } } } } } }; m: number } | { a: { b: { c: { d: { e: { f: { g: { v: "s" } } } } } } }; m: number };
type CastD8 = { a: { b: { c: { d: { e: { f: { g: { h: { v: 1 } } } } } } } }; m: number } | { a: { b: { c: { d: { e: { f: { g: { h: { v: "s" } } } } } } } }; m: number };
type CastKinds = { a: { b: { c: { d: { e: { v: number } } } } }; m: number } | { a: { b: { c: { d: { e: { v: string } } } } }; m: number } | { a: { b: { c: { d: { e: { w: boolean } } } } }; m: number };
type CastInLists = { a: { b: { c: { list: { d: { e: { v: 1 } } }[] } } }; m: number } | { a: { b: { c: { list: { d: { e: { v: "s" } } }[] } } }; m: number };
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
function all(label: string, parse: (text: string) => any, validate: (text: string) => any, cast: (text: string) => any, texts: string[]): void {
  for (let round = 0; round < 2; round++) {
    for (const text of texts) {
      say(label + ", parsed " + text, parse, text);
      say(label + ", validated " + text, validate, text);
      say(label + ", cast " + text, cast, text);
    }
  }
}
all("1 below", text => JSON.parse<D1>(text), text => validate<D1>(JSON.parse(text)), text => JSON.parse(text.replace('"n":1', '"m":1')) as CastD1, [textOf(1, '{"v":"s"}'), textOf(1, '{"v":1}'), textOf(1, '{"v":"s"}')]);
say("1 below, neither", text => JSON.parse<D1>(text), textOf(1, '{"v":2}'));
all("2 below", text => JSON.parse<D2>(text), text => validate<D2>(JSON.parse(text)), text => JSON.parse(text.replace('"n":1', '"m":1')) as CastD2, [textOf(2, '{"v":"s"}'), textOf(2, '{"v":1}'), textOf(2, '{"v":"s"}')]);
say("2 below, neither", text => JSON.parse<D2>(text), textOf(2, '{"v":2}'));
all("3 below", text => JSON.parse<D3>(text), text => validate<D3>(JSON.parse(text)), text => JSON.parse(text.replace('"n":1', '"m":1')) as CastD3, [textOf(3, '{"v":"s"}'), textOf(3, '{"v":1}'), textOf(3, '{"v":"s"}')]);
say("3 below, neither", text => JSON.parse<D3>(text), textOf(3, '{"v":2}'));
all("4 below", text => JSON.parse<D4>(text), text => validate<D4>(JSON.parse(text)), text => JSON.parse(text.replace('"n":1', '"m":1')) as CastD4, [textOf(4, '{"v":"s"}'), textOf(4, '{"v":1}'), textOf(4, '{"v":"s"}')]);
say("4 below, neither", text => JSON.parse<D4>(text), textOf(4, '{"v":2}'));
all("5 below", text => JSON.parse<D5>(text), text => validate<D5>(JSON.parse(text)), text => JSON.parse(text.replace('"n":1', '"m":1')) as CastD5, [textOf(5, '{"v":"s"}'), textOf(5, '{"v":1}'), textOf(5, '{"v":"s"}')]);
say("5 below, neither", text => JSON.parse<D5>(text), textOf(5, '{"v":2}'));
all("6 below", text => JSON.parse<D6>(text), text => validate<D6>(JSON.parse(text)), text => JSON.parse(text.replace('"n":1', '"m":1')) as CastD6, [textOf(6, '{"v":"s"}'), textOf(6, '{"v":1}'), textOf(6, '{"v":"s"}')]);
say("6 below, neither", text => JSON.parse<D6>(text), textOf(6, '{"v":2}'));
all("7 below", text => JSON.parse<D7>(text), text => validate<D7>(JSON.parse(text)), text => JSON.parse(text.replace('"n":1', '"m":1')) as CastD7, [textOf(7, '{"v":"s"}'), textOf(7, '{"v":1}'), textOf(7, '{"v":"s"}')]);
say("7 below, neither", text => JSON.parse<D7>(text), textOf(7, '{"v":2}'));
all("8 below", text => JSON.parse<D8>(text), text => validate<D8>(JSON.parse(text)), text => JSON.parse(text.replace('"n":1', '"m":1')) as CastD8, [textOf(8, '{"v":"s"}'), textOf(8, '{"v":1}'), textOf(8, '{"v":"s"}')]);
say("8 below, neither", text => JSON.parse<D8>(text), textOf(8, '{"v":2}'));
all("three kinds", text => JSON.parse<Kinds>(text), text => validate<Kinds>(JSON.parse(text)), text => JSON.parse(text.replace('"n":1', '"m":1')) as CastKinds, [textOf(5, '{"w":true}'), textOf(5, '{"v":"s"}'), textOf(5, '{"v":1.5}')]);
const list = (leaves: string[]) => textOf(3, '{"list":[' + leaves.map(leaf => '{"d":{"e":' + leaf + "}}").join(",") + "]}");
all("within lists", text => JSON.parse<InLists>(text), text => validate<InLists>(JSON.parse(text)), text => JSON.parse(text.replace('"n":1', '"m":1')) as CastInLists, [list(['{"v":"s"}']), list(['{"v":1}', '{"v":1}']), list(['{"v":"s"}', '{"v":"s"}', '{"v":"s"}']), list([])]);
say("within lists, both kinds in one", text => JSON.parse<InLists>(text), list(['{"v":1}', '{"v":"s"}']));
const several = "[" + [textOf(6, '{"v":"s"}'), textOf(6, '{"v":1}'), textOf(6, '{"v":"s"}'), textOf(6, '{"v":1}')].join(",") + "]";
for (const [label, run] of [["parsed", (text: string) => JSON.parse<D6[]>(text)], ["validated", (text: string) => validate<D6[]>(JSON.parse(text))], ["cast", (text: string) => JSON.parse(text.replaceAll('"n":1', '"m":1')) as CastD6[]]] as const) {
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
function readCast(value: CastD5): string {
  const leaf = value.a.b.c.d.e.v;
  return typeof leaf === "string" ? "text " + leaf : "number " + (leaf + 1);
}
for (const run of [() => read(JSON.parse<D5>(textOf(5, '{"v":"s"}'))), () => read(JSON.parse<D5>(textOf(5, '{"v":1}'))), () => read(validate<D5>(JSON.parse(textOf(5, '{"v":"s"}')))), () => readCast(JSON.parse(textOf(5, '{"v":"s"}').replace('"n":1', '"m":1')) as CastD5)]) {
  try {
    console.log(run());
  } catch (error: any) {
    console.log(error.name);
  }
}
