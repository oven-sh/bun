// JSON.parse(text) without a type argument, returned as a union of records that contains itself: the time grows with the length of the text, not by a factor for each level.
type ByName = { below: ByName | null; a: number } | { below: ByName | null; b: number };
type ByKind = { below: ByKind | null; k: number } | { below: ByKind | null; k: string };
type ByTag = { below: ByTag | null; k: "one" } | { below: ByTag | null; k: "two" };
type InLists = { below: InLists[]; k: number[] } | { below: InLists[]; k: string[] };
type Forked = { left: Forked | null; right: Forked | null; k: 1 } | { left: Forked | null; right: Forked | null; k: 2 };

const byName = (text: string): ByName => JSON.parse(text);
const byKind = (text: string): ByKind => JSON.parse(text);
const byTag = (text: string): ByTag => JSON.parse(text);
const inLists = (text: string): InLists => JSON.parse(text);
const forked = (text: string): Forked => JSON.parse(text);

const nest = (open: string, middle: string, close: string, levels: number) => open.repeat(levels) + middle + close.repeat(levels);
const kinds: [string, (text: string) => unknown, (levels: number) => string][] = [
  ["other names", byName, levels => nest('{"below":', "null", ',"b":1}', levels)],
  ["a number or a string", byKind, levels => nest('{"below":', "null", ',"k":"s"}', levels)],
  ["text tags", byTag, levels => nest('{"below":', "null", ',"k":"two"}', levels)],
  ["lists", inLists, levels => nest('{"below":[', "", '],"k":["s"]}', levels)],
  ["two nested members", forked, levels => nest('{"left":null,"right":', "null", ',"k":2}', levels)],
];

for (const [label, parse, text] of kinds) {
  for (const levels of [1, 20, 40, 200, 2000]) {
    const given = text(levels);
    const start = Date.now();
    const isSame = JSON.stringify(parse(given)) === given;
    console.log(label + ", " + levels + " levels: " + (isSame ? "what JSON.parse gives" : "ANOTHER VALUE") + (Date.now() - start > 1000 ? " TOO SLOWLY" : ""));
  }
}
