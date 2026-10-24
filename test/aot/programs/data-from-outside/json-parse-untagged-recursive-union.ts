// Arms without a tag that share a recursive member and differ after it: no nested value is parsed once per arm, so sixty levels end.
type List = { next: List | null; a: number } | { next: List | null; b: number };
type Pair = { a: Pair | null; b: 1 } | { a: Pair | null; c: 2 };
function nested(head: string, levels: number, tail: string): string {
  return head.repeat(levels) + "null" + tail.repeat(levels);
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
for (const levels of [1, 2, 20, 40, 60]) {
  say("the first arm " + levels, text => JSON.parse<List>(text), nested('{"next":', levels, ',"a":1}'));
  say("the second arm " + levels, text => JSON.parse<List>(text), nested('{"next":', levels, ',"b":1}'));
  say("a literal member in each arm " + levels, text => JSON.parse<Pair>(text), nested('{"a":', levels, ',"c":2}'));
}
for (const levels of [1, 2]) say("neither arm " + levels, text => JSON.parse<List>(text), nested('{"next":', levels, ',"c":1}'));
