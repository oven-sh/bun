// Unions that no tag tells apart lie below one another, each under a name of its own: no type refers to itself. Every member of a level holds the level below under the same name, and only the last member fits the text.
// The time of a parse goes with the size of the text, not with the number of members to the power of the levels.
type L0 = { v: number } | { v: string };
type L1 = { left: L0; v: number } | { left: L0; v: boolean } | { left: L0; v: string };
type L2 = { left: L1; v: number } | { left: L1; v: boolean } | { left: L1; v: string };
type L3 = { left: L2; v: number } | { left: L2; v: boolean } | { left: L2; v: string };
type L4 = { left: L3; v: number } | { left: L3; v: boolean } | { left: L3; v: string };
type L5 = { left: L4; v: number } | { left: L4; v: boolean } | { left: L4; v: string };
type L6 = { left: L5; v: number } | { left: L5; v: boolean } | { left: L5; v: string };
type L7 = { left: L6; v: number } | { left: L6; v: boolean } | { left: L6; v: string };
type L8 = { left: L7; v: number } | { left: L7; v: boolean } | { left: L7; v: string };
type L9 = { left: L8; v: number } | { left: L8; v: boolean } | { left: L8; v: string };
type L10 = { left: L9; v: number } | { left: L9; v: boolean } | { left: L9; v: string };
type L11 = { left: L10; v: number } | { left: L10; v: boolean } | { left: L10; v: string };
type L12 = { left: L11; v: number } | { left: L11; v: boolean } | { left: L11; v: string };
type L13 = { left: L12; v: number } | { left: L12; v: boolean } | { left: L12; v: string };
type L14 = { left: L13; v: number } | { left: L13; v: boolean } | { left: L13; v: string };
type L15 = { left: L14; v: number } | { left: L14; v: boolean } | { left: L14; v: string };
type L16 = { left: L15; v: number } | { left: L15; v: boolean } | { left: L15; v: string };
type L17 = { left: L16; v: number } | { left: L16; v: boolean } | { left: L16; v: string };
type L18 = { left: L17; v: number } | { left: L17; v: boolean } | { left: L17; v: string };
type L19 = { left: L18; v: number } | { left: L18; v: boolean } | { left: L18; v: string };
type L20 = { left: L19; v: number } | { left: L19; v: boolean } | { left: L19; v: string };

function nested(levels: number, deepest: unknown): unknown {
  let value: unknown = { v: deepest };
  for (let level = 0; level < levels; level++) value = { left: value, v: "text" };
  return value;
}

function depthOf(value: any): number {
  let depth = 0;
  while (value.left !== undefined) {
    value = value.left;
    depth++;
  }
  return depth;
}

function timed(label: string, run: () => unknown): void {
  const start = Date.now();
  let said: string;
  try {
    said = "taken, " + depthOf(run()) + " levels";
  } catch (error: any) {
    said = error.name;
  }
  console.log(label + ": " + said + (Date.now() - start > 10000 ? " TOO SLOW" : ""));
}

const right = nested(20, "text");
const wrong = nested(20, null);
timed("a text", () => JSON.parse(JSON.stringify(right)) as L20);
timed("a text with a name spelled by an escape", () => JSON.parse(JSON.stringify(right).replace('"left"', '"\\u006ceft"')) as L20);
timed("a text that is wrong at its deepest place", () => JSON.parse(JSON.stringify(wrong)) as L20);
timed("a list of a hundred", () => (JSON.parse(JSON.stringify(Array.from({ length: 100 }, () => right))) as L20[])[99]);
