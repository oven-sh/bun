// Recursive unions of every kind, 20 to 2,000 levels deep, in texts that fit and texts that do not, by `JSON.parse(text) as T` (also with an escape in the first key): nothing looks at a nested value once for each arm: with two looks a level the texts of 200 levels would never be read to their end.
type NumberTag = { below: NumberTag | null; k: 1 } | { below: NumberTag | null; k: 2 };
type FlagTag = { below: FlagTag | null; k: true } | { below: FlagTag | null; k: false };
type TextTag = { below: TextTag | null; k: "one" } | { below: TextTag | null; k: "two" };
type Kinds = { below: Kinds | null; k: number } | { below: Kinds | null; k: string };
type FourKinds = { below: FourKinds | null; k: number } | { below: FourKinds | null; k: string } | { below: FourKinds | null; k: boolean } | { below: FourKinds | null; k: null };
type Below = { below: Below | null; x: { k: 1 } } | { below: Below | null; x: { k: 2 } };
type BelowText = { below: BelowText | null; x: { k: "one" } } | { below: BelowText | null; x: { k: "two" } };
type Lists = { below: Lists[]; k: number[] } | { below: Lists[]; k: string[] };
type Tuples = [Tuples | null, 1] | [Tuples | null, 2];
type Arrays = (Arrays | 1)[] | (Arrays | "a")[];
type Table = Record<string, { below: Table; k: number } | { below: Table; k: string }>;
type Optional = { below?: Optional; a?: number } | { below?: Optional; a?: string };
type Names = { below: Names | null; a: number } | { below: Names | null; b: number };
type Mixed = { below: Mixed | null; k: "one" } | { below: Mixed | null; k: 2 } | { below: Mixed | null; k: false } | { below: Mixed | null; k: null };
type TextOrNull = { below: TextOrNull | null; k: "one" } | { below: TextOrNull | null; k: null };
type Forked = { left: Forked | null; right: Forked | null; k: "one" } | { left: Forked | null; right: Forked | null; k: null };
type TwoBelow = { left: TwoBelow | null; right: TwoBelow | null; k: 1 } | { left: TwoBelow | null; right: TwoBelow | null; k: 2 };

const nest = (open: string, middle: string, close: string, levels: number) => open.repeat(levels) + middle + close.repeat(levels);
const kinds: [string, (text: string) => unknown, (levels: number, bottom: string) => string, string][] = [
  ["number tags", text => JSON.parse(text) as NumberTag, (levels, bottom) => nest('{"below":', bottom, ',"k":2}', levels), "null"],
  ["true or false", text => JSON.parse(text) as FlagTag, (levels, bottom) => nest('{"below":', bottom, ',"k":false}', levels), "null"],
  ["text tags", text => JSON.parse(text) as TextTag, (levels, bottom) => nest('{"below":', bottom, ',"k":"two"}', levels), "null"],
  ["a number or a string", text => JSON.parse(text) as Kinds, (levels, bottom) => nest('{"below":', bottom, ',"k":"s"}', levels), "null"],
  ["four kinds", text => JSON.parse(text) as FourKinds, (levels, bottom) => nest('{"below":', bottom, ',"k":null}', levels), "null"],
  ["a number tag one level below", text => JSON.parse(text) as Below, (levels, bottom) => nest('{"below":', bottom, ',"x":{"k":2}}', levels), "null"],
  ["a text tag one level below", text => JSON.parse(text) as BelowText, (levels, bottom) => nest('{"below":', bottom, ',"x":{"k":"two"}}', levels), "null"],
  ["lists of numbers or of strings", text => JSON.parse(text) as Lists, (levels, bottom) => nest('{"below":[', bottom, '],"k":["s"]}', levels), ""],
  ["tuples", text => JSON.parse(text) as Tuples, (levels, bottom) => nest("[", bottom, ",2]", levels), "null"],
  ["arrays", text => JSON.parse(text) as Arrays, (levels, bottom) => nest("[", bottom, ',"a"]', levels), '"a"'],
  ["a dictionary of a union", text => JSON.parse(text) as Table, (levels, bottom) => nest('{"e":{"below":', bottom, ',"k":"s"}}', levels), "{}"],
  ["optional members only", text => JSON.parse(text) as Optional, (levels, bottom) => nest('{"below":', bottom, ',"a":"s"}', levels), "{}"],
  ["other names", text => JSON.parse(text) as Names, (levels, bottom) => nest('{"below":', bottom, ',"b":1}', levels), "null"],
  ["tags of four kinds, null", text => JSON.parse(text) as Mixed, (levels, bottom) => nest('{"below":', bottom, ',"k":null}', levels), "null"],
  ["tags of four kinds, a text", text => JSON.parse(text) as Mixed, (levels, bottom) => nest('{"below":', bottom, ',"k":"one"}', levels), "null"],
  ["tags of four kinds, a number", text => JSON.parse(text) as Mixed, (levels, bottom) => nest('{"below":', bottom, ',"k":2}', levels), "null"],
  ["tags of four kinds, false", text => JSON.parse(text) as Mixed, (levels, bottom) => nest('{"below":', bottom, ',"k":false}', levels), "null"],
  ["a text or null", text => JSON.parse(text) as TextOrNull, (levels, bottom) => nest('{"below":', bottom, ',"k":null}', levels), "null"],
  ["two nested members, a text or null", text => JSON.parse(text) as Forked, (levels, bottom) => nest('{"left":null,"right":', bottom, ',"k":null}', levels), "null"],
  ["two nested members", text => JSON.parse(text) as TwoBelow, (levels, bottom) => nest('{"left":null,"right":', bottom, ',"k":2}', levels), "null"],
];

function answer(run: () => unknown, text: string): string {
  let said = "";
  try {
    said = JSON.stringify(run()) === text ? "what JSON.parse gives" : "ANOTHER VALUE";
  } catch (error: any) {
    said = error.name + ": " + error.message;
  }
  return said;
}

for (const [label, parse, text, bottom] of kinds) {
  for (const levels of [20, 40, 200, 2000]) {
    const fits = text(levels, bottom);
    const misfits = text(levels, "[[7]]");
    const escaped = fits.replace(/^(\[*\{")(.)/, (_, start, first) => start + "\\u00" + first.charCodeAt(0).toString(16));
    console.log(label + ", " + levels + " levels: " + [answer(() => parse(fits), fits), answer(() => parse(escaped), fits), answer(() => parse(misfits), misfits)].join(", "));
  }
}

const fork = (levels: number, tail: string): string => (levels === 0 ? "null" : '{"left":' + fork(levels - 1, tail) + ',"right":' + fork(levels - 1, tail) + tail);
for (const levels of [2, 6, 10, 14]) {
  const forked = fork(levels, ',"k":null}');
  const two = fork(levels, ',"k":2}');
  console.log("a full tree of " + levels + " levels: " + [answer(() => JSON.parse(forked) as Forked, forked), answer(() => JSON.parse(forked.replace('"left"', '"\\u006ceft"')) as Forked, forked), answer(() => JSON.parse(two) as TwoBelow, two)].join(", "));
}
