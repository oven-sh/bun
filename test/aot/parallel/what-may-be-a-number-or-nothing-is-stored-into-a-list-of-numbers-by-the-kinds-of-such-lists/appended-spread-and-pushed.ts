// what a function that may be left at its end gives goes into lists of numbers by a literal with a spread in front, by push, by a store at the length; whole numbers, fractions, NaN, -0 and undefined (a kind out of a parse)
type Kind = "one" | "half" | "none" | "zero";
function pick(kind: Kind, depth: number): number {
  if (depth > 0) return pick(kind, depth - 1);
  switch (kind) {
    case "one": return 1;
    case "half": return 0.5;
    case "none": return (depth - depth) / depth;
    case "zero": return -depth;
  }
}
function behind(list: number[], kind: Kind): number[] { return [...list, pick(kind, 1)]; }
function between(list: number[], kind: Kind): number[] { return [pick(kind, 1), ...list, pick(kind, 2), 7]; }
function pushed(list: number[], kind: Kind): number { return list.push(pick(kind, 1)); }
function atTheEnd(list: number[], kind: Kind): number { return (list[list.length] = pick(kind, 1)); }
const kinds = JSON.parse('["one","half","other","none","zero","one","other"]') as Kind[];
const said: string[] = [];
const show = (list: number[]) => list.map((x, i) => (i in list ? (Object.is(x, -0) ? "-0" : String(x)) : "hole")).join() + "|" + list.length + "|" + Object.keys(list).length;
for (let round = 0; round < 40; round++) {
  said.length = 0;
  for (const make of [() => [round, 2, 3], () => [0.5, round + 0.5], () => [] as number[], () => [1, , 3] as number[]]) {
    let one = make(), two = make();
    const three = make(), four = make();
    for (const kind of kinds) {
      one = behind(one, kind); two = between(two, kind);
      said.push(String(pushed(three, kind)), String(atTheEnd(four, kind)));
    }
    said.push(show(one), show(two), show(three), show(four));
  }
}
console.log(said.join(" "));
