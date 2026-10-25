// Texts nested 100 to 1,000,000 levels deep through recursive types, through members of unknown type and through undeclared keys, at the top of the stack and near its end: `JSON.parse(text) as T` gives the value or a RangeError, nothing else, and goes on working afterwards.
type Tree = { kids: Tree[] };
type Chain = { next: Chain | null };
type Link = { name: string; next?: Link };
type Deep = Deep[];
type Bag = { [key: string]: Bag };
type Pair = [Pair] | [];
type Either = { kind: "leaf" } | { kind: "node"; below: Either };
type Loose = { value: unknown };
type Any = { value: any };
type Point = { x: number; y: number };

type Road = { label: string; parse: (text: string) => unknown; text: (levels: number) => string; depth: (levels: number) => number };
const roads: Road[] = [
  { label: "records and arrays", parse: text => JSON.parse(text) as Tree, text: levels => '{"kids":['.repeat(levels) + "]}".repeat(levels), depth: levels => 2 * levels },
  { label: "records", parse: text => JSON.parse(text) as Chain, text: levels => '{"next":'.repeat(levels) + "null" + "}".repeat(levels), depth: levels => levels },
  { label: "an optional member behind another", parse: text => JSON.parse(text) as Link, text: levels => '{"name":"n","next":'.repeat(levels) + '{"name":"last"}' + "}".repeat(levels), depth: levels => levels + 1 },
  { label: "records in another order, with undeclared keys", parse: text => JSON.parse(text) as Link, text: levels => '{"other":1,"next":'.repeat(levels) + '{"name":"last"}' + ',"name":"n"}'.repeat(levels), depth: levels => levels + 1 },
  { label: "arrays", parse: text => JSON.parse(text) as Deep, text: levels => "[".repeat(levels) + "]".repeat(levels), depth: levels => levels },
  { label: "dictionaries", parse: text => JSON.parse(text) as Bag, text: levels => '{"k":'.repeat(levels) + "{}" + "}".repeat(levels), depth: levels => levels + 1 },
  { label: "tuples", parse: text => JSON.parse(text) as Pair, text: levels => "[".repeat(levels) + "]".repeat(levels), depth: levels => levels },
  { label: "a tagged union", parse: text => JSON.parse(text) as Either, text: levels => '{"kind":"node","below":'.repeat(levels) + '{"kind":"leaf"}' + "}".repeat(levels), depth: levels => levels + 1 },
  { label: "a tagged union, the tag last", parse: text => JSON.parse(text) as Either, text: levels => '{"below":'.repeat(levels) + '{"kind":"leaf"}' + ',"kind":"node"}'.repeat(levels), depth: levels => levels + 1 },
  { label: "arrays under unknown", parse: text => JSON.parse(text) as Loose, text: levels => '{"value":' + "[".repeat(levels) + "]".repeat(levels) + "}", depth: levels => levels + 1 },
  { label: "objects under any", parse: text => JSON.parse(text) as Any, text: levels => '{"value":' + '{"a":'.repeat(levels) + "1" + "}".repeat(levels) + "}", depth: levels => levels + 1 },
  { label: "arrays under an undeclared key", parse: text => JSON.parse(text) as Point, text: levels => '{"x":1,"y":2,"other":' + "[".repeat(levels) + "]".repeat(levels) + "}", depth: levels => levels + 1 },
];

function depthOf(value: any): number {
  let depth = 0;
  while (typeof value === "object" && value !== null) {
    depth++;
    let next: any = undefined;
    for (const key in value) if (typeof value[key] === "object") next = value[key];
    value = next;
  }
  return depth;
}

function answer(parse: (text: string) => unknown, text: string): string {
  try {
    return "depth " + depthOf(parse(text));
  } catch (error: any) {
    return error.name + ": " + error.message;
  }
}

const overflow = "RangeError: Maximum call stack size exceeded.";
const afterwards = (road: Road) => [road.text(3), road.text(3).replace(/[\]}]$/, ""), road.text(3).replace(/null|\{\}|\[\]|"leaf"|"last"|1/, "false"), '{"x":1,"y":2}', "[]"].map(text => answer(road.parse, text)).join("; ");

for (const road of roads) {
  const before = afterwards(road);
  let wrong = 0;
  let changed = 0;
  const ask = (levels: number): boolean => {
    const said = answer(road.parse, road.text(levels));
    if (said !== overflow && said !== "depth " + road.depth(levels)) wrong++;
    if (afterwards(road) !== before) changed++;
    return said === overflow;
  };
  for (const levels of [100, 10_000, 1_000_000]) ask(levels);
  let high = 1000;
  while (high < 1_000_000 && !ask(high)) high *= 2;
  if (high < 1_000_000) {
    let low = high / 2;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (ask(middle)) high = middle;
      else low = middle;
    }
    for (let levels = high - 300; levels < high + 300; levels += 67) ask(levels);
    for (let levels = high - 3; levels < high + 3; levels++) ask(levels);
  }

  const cut = road.text(1_000_000).slice(0, 1_000_000);
  if (answer(road.parse, cut) !== answer(globalThis.JSON.parse, cut)) wrong++;

  const depths = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181];
  const texts = depths.map(road.text);
  let frames = 0;
  let values = 0;
  const dive = (level: number): void => {
    try {
      dive(level + 1);
    } catch {
      if (frames === 0) frames = level;
    }
    if (frames - level > 3000) return;
    const which = level % depths.length;
    const said = answer(road.parse, texts[which]);
    if (said === "depth " + road.depth(depths[which])) values++;
    else if (said !== overflow) wrong++;
  };
  dive(0);
  if (afterwards(road) !== before) changed++;
  console.log(road.label + ": " + wrong + " answers are neither the value nor a RangeError, " + changed + " times it went on otherwise than before, " + (values > 0 ? "some" : "NO") + " values near the end of the stack");
}
