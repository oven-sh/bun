type Tree = { kids: Tree[] };
type Deep = Deep[];
type Loose = { value: unknown };
type Item = { id: number; name: string; tags: string[]; inner: { a: number; b?: string } };

const overflow = "RangeError: Maximum call stack size exceeded.";

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

const roads: [(text: string) => unknown, (levels: number) => string, (levels: number) => number][] = [
  [text => JSON.parse<Tree>(text), levels => '{"kids":['.repeat(levels) + "]}".repeat(levels), levels => 2 * levels],
  [text => JSON.parse<Deep>(text), levels => "[".repeat(levels) + "]".repeat(levels), levels => levels],
  [text => JSON.parse<Loose>(text), levels => '{"value":' + "[".repeat(levels) + "]".repeat(levels) + "}", levels => levels + 1],
];

export function work(number: number): string {
  let wrong = 0;
  let values = 0;
  for (const [parse, text, depth] of roads) {
    for (const levels of [100, 10_000, 100_000]) {
      const said = answer(parse, text(levels));
      if (said === "depth " + depth(levels)) values++;
      else if (said !== overflow) wrong++;
    }
    const depths = [1, 3, 8, 21, 55, 144, 377, 987, 2584];
    const texts = depths.map(text);
    let frames = 0;
    const dive = (level: number): void => {
      try {
        dive(level + 1);
      } catch {
        if (frames === 0) frames = level;
      }
      if (frames - level > 100) return;
      const which = level % depths.length;
      const said = answer(parse, texts[which]);
      if (said === "depth " + depth(depths[which])) values++;
      else if (said !== overflow) wrong++;
    };
    dive(0);
  }
  let different = 0;
  for (let round = 0; round < 3000; round++) {
    const id = number * 100000 + round;
    const members = ['"id":' + id, '"name":"name ' + id + ' that is longer than a short string would be"', '"tags":["t' + (round % 9) + '","' + id + '"]', '"inner":{"a":' + round + (round % 2 ? ',"b":"b"' : "") + (round % 5 ? "" : ',"x":[' + id + "]") + "}"];
    if (round % 3 === 0) members.splice(round % 4, 0, '"extra' + (round % 11) + '":{"e":' + id + "}");
    if (round % 7 === 0) members.reverse();
    const text = "{" + members.join(",") + "}";
    const value = JSON.parse<Item>(text);
    if (value.id !== id || value.inner.a !== round || JSON.stringify(value) !== text) different++;
  }
  return wrong + " answers are neither the value nor a RangeError, " + (values > 0 ? "some" : "NO") + " values, " + different + " of 3000 records differ";
}
