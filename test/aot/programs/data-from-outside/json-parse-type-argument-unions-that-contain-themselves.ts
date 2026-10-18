// A union that contains itself: the arms are told apart by a constant member of any kind, wherever it stands, and no nested value is parsed twice: a text of sixty levels would otherwise take longer than the sun has left.
type ByNumber = { below: ByNumber | null; k: 1 } | { below: ByNumber | null; k: 2 };
type ByBoolean = { below: ByBoolean | null; k: true } | { below: ByBoolean | null; k: false };
type ByNull = { below: ByNull | null; k: null } | { below: ByNull | null; k: 1 };
type ByText = { below: ByText | null; k: "one" } | { below: ByText | null; k: "two" };
type Mixed = { below: Mixed | null; k: "one" } | { below: Mixed | null; k: 2 } | { below: Mixed | null; k: false } | { below: Mixed | null; k: null };
type InList = { k: 1; list: InList[] } | { k: 2; list: InList[] };
function nested(levels: number, tail: string): string {
  return '{"below":'.repeat(levels) + "null" + tail.repeat(levels);
}
function say(label: string, parse: (text: string) => unknown, text: string): void {
  let said = "";
  try {
    said = JSON.stringify(parse(text)) === JSON.stringify(JSON.parse(text)) ? "what JSON.parse gives" : "DIFFERENT";
  } catch (error: any) {
    said = error.name;
  }
  console.log(label + ": " + said);
}
for (const levels of [1, 2, 3, 20, 40, 60, 63, 64, 65, 66, 200]) {
  say("number tags " + levels, text => JSON.parse<ByNumber>(text), nested(levels, ',"k":2}'));
  say("number tags, the first arm " + levels, text => JSON.parse<ByNumber>(text), nested(levels, ',"k":1}'));
  say("number tags, in turn " + levels, text => JSON.parse<ByNumber>(text), nested(2 * levels, ',"k":1}').replaceAll(',"k":1},"k":1}', ',"k":2},"k":1}'));
  say("number tags, written otherwise " + levels, text => JSON.parse<ByNumber>(text), nested(levels, ' , "k" : 2.0e0 }'));
  say("number tags, in front " + levels, text => JSON.parse<ByNumber>(text), '{"k":2,"below":'.repeat(levels) + "null" + "}".repeat(levels));
  say("number tags, no arm has it " + levels, text => JSON.parse<ByNumber>(text), nested(levels, ',"k":3}'));
  say("number tags, the innermost is wrong " + levels, text => JSON.parse<ByNumber>(text), nested(levels, ',"k":2}').replace('null,"k":2', 'null,"k":"2"'));
  say("true | false " + levels, text => JSON.parse<ByBoolean>(text), nested(levels, ',"k":false}'));
  say("true | false, neither " + levels, text => JSON.parse<ByBoolean>(text), nested(levels, ',"k":0}'));
  say("null | 1 " + levels, text => JSON.parse<ByNull>(text), nested(levels, ',"k":null}'));
  say("text tags " + levels, text => JSON.parse<ByText>(text), nested(levels, ',"k":"two"}'));
  say("text tags, no arm has it " + levels, text => JSON.parse<ByText>(text), nested(levels, ',"k":"three"}'));
  say("within lists " + levels, text => JSON.parse<InList>(text), '{"list":[{"list":[],"k":1},'.repeat(levels) + '{"k":2,"list":[]}' + '],"k":2}'.repeat(levels));
  if (levels > 60) continue;
  say("tags of four kinds " + levels, text => JSON.parse<Mixed>(text), nested(levels, ',"k":null}'));
  if (levels <= 15) say("tags of four kinds, in turn " + levels, text => JSON.parse<Mixed>(text), nested(4 * levels, ',"k":2}').replaceAll(',"k":2},"k":2},"k":2},"k":2}', ',"k":"one"},"k":2},"k":false},"k":null}'));
  say("tags of four kinds, no arm has it " + levels, text => JSON.parse<Mixed>(text), nested(levels, ',"k":true}'));
}

type Flat = { value: number; unit: string } | { error: string; code: number } | { value: string };
type Below = { a: { x: number }; n: number } | { a: { y: number }; n: number } | { a: { x: number }; n: string };
type Lists = number[] | string[] | [boolean, number[]] | { list: number[] } | { list: string[] };
type Tagged = { kind: 1; parts: number[] } | { kind: 2; parts: string[] } | { kind: number; parts?: unknown };
for (const text of ['{"value":1,"unit":"m"}', '{"error":"none","code":4}', '{"value":"v"}', '{"value":"v","o":{"deep":[1,{"er":2}]}}', '{"o":[[]],"code":4,"error":"e"}', '{"value":1}', '{"value":null}', "{}", "[]", "null"]) say("arms that hold no objects " + text, given => JSON.parse<Flat>(given), text);
for (const text of ['{"a":{"x":1},"n":1}', '{"a":{"y":1},"n":1}', '{"a":{"x":1},"n":"s"}', '{"n":"s","a":{"x":1}}', '{"a":{"y":1},"n":"s"}', '{"a":{"x":1,"y":1},"n":1}', '{"a":{},"n":1}', '{"a":{"x":1}}']) say("arms that differ below " + text, given => JSON.parse<Below>(given), text);
for (const text of ["[]", "[1,2]", '["a"]', '[1,"a"]', "[true,[1]]", '[true,["a"]]', '{"list":[]}', '{"list":[1]}', '{"list":["a"]}', '{"list":[1,"a"]}', '{"list":[[]]}']) say("lists " + text, given => JSON.parse<Lists>(given), text);
for (const text of ['{"kind":1,"parts":[1]}', '{"kind":2,"parts":["a"]}', '{"kind":1,"parts":["a"]}', '{"parts":["a"],"kind":1}', '{"kind":3,"parts":{"any":[1]}}', '{"kind":3}', '{"kind":"1","parts":[1]}', '{"parts":[1]}']) say("the arm that the tag names refuses " + text, given => JSON.parse<Tagged>(given), text);
