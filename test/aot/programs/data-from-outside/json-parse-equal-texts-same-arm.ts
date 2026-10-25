// JSON.parse<T>: texts that JSON.parse reads as one value select one arm of a union, however a key is written: with an escape, twice, or between white space. The defaults show which arm it was.
// IR+ ^ .*JSONGiveUpIfMemberRepeats
// IR+ ^ .*JSONGiveUpIfKeyRepeats
import { JSON } from "bun"; import type { Schema } from "bun";

type Counted = { n: number & Schema.Default<1> };
type Marked = { a: unknown; d: number & Schema.Default<2> };
type Indexed = { k: number; [key: string]: number };
type Listed = { k: number; q: unknown; d: number & Schema.Default<2> };
type First = { kind: "a"; n: number & Schema.Default<1> };
type Second = { kind: "b" };
type Other = { m: number & Schema.Default<3> };

function shown(parse: (text: string) => unknown, text: string): string {
  try {
    return JSON.stringify(parse(text));
  } catch (error: any) {
    return error.name;
  }
}

function compare(label: string, parse: (text: string) => unknown, texts: string[]): void {
  const expected = shown(parse, texts[0]);
  for (const text of texts.slice(1)) console.log(label + ", " + JSON.stringify(text) + ": " + (shown(parse, text) === expected ? "same" : "DIFFERENT"));
}

compare("dictionary before any object", text => JSON.parse<Record<string, Counted> | object>(text), [
  '{"a":{}}',
  '{"\\u0061":{}}',
  '{ "a" : {} }',
  '{"a":1,"a":{}}',
  '{"a":1,"\\u0061":{}}',
]);
compare("dictionary accepts", text => JSON.parse<Record<string, Counted> | Marked>(text), ['{"a":{}}', '{"a":"s","a":{}}', '{"a":"s","\\u0061":{}}', '{"\\u0061":{}}']);
compare("dictionary rejects", text => JSON.parse<Record<string, Counted> | Marked>(text), ['{"a":"s"}', '{"a":{},"a":"s"}', '{"\\u0061":"s"}', '{"a" :"s" }']);
compare("index signature accepts", text => JSON.parse<Indexed | Listed>(text), ['{"k":1,"q":2}', '{"k":1,"q":"s","q":2}', '{"k":1,"q":"s","\\u0071":2}']);
compare("index signature rejects", text => JSON.parse<Indexed | Listed>(text), ['{"k":1,"q":"s"}', '{"k":1,"q":2,"q":"s"}', '{"k":1,"\\u0071":"s"}']);

const byTag = (text: string) => JSON.parse<First | Second | Other>(text);
compare("tag found", byTag, ['{"kind":"a"}', '{ "kind" : "a" }', '{"kind":1,"kind":"a"}', '{"kind":"b","kind":"a"}', '{"\\u006bind":"a"}', '{"kind":"\\u0061"}']);
compare("tag after another member", byTag, ['{"x":[{}],"kind":"a"}', '{"x":[{}],"kind":"b","kind":"a"}', '{"\\u0078":[{}],"kind":"a"}']);
compare("empty object", byTag, ["{}", "{ }", "{\n}"]);
compare("tag absent", byTag, ['{"x":1}', '{ "x" : 1 }', '{"x":2,"x":1}', '{"\\u0078":1}']);
compare("tag names no arm", byTag, ['{"kind":"c"}', '{"kind":"a","kind":"c"}', '{"\\u006bind":"c"}']);
compare("tag names no arm, no other arm", text => JSON.parse<First | Second>(text), ['{"kind":"c"}', '{"kind":"a","kind":"c"}', '{"\\u006bind":"c"}', '{"kind":"\\u0063"}']);
compare("not JSON", byTag, ['{"x":1,}', '{"\\uZZZZ":1,"kind":"a"}', '{"\\x":1,"kind":"a"}', '{"x":1 "kind":"a"}', '{"kind":"a"', '{"x":,"kind":"a"}', "{,}"]);
