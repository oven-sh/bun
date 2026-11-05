// Two members of a union of texts stand in the type alone: no code spells them. Texts equal to them come from a parser, from joined pieces and from a reversed text. They are stored into typed fields, read, compared, switched on, used as keys and printed, beside the two members that code does spell, a text that is no member and the empty text. Where narrowing leaves one such member, the value is printed as it came
type Color = "red" | "amber" | "green" | "violet";
interface Lamp { color: Color; next?: Color; watts: number }
class Signal {
  color: Color = "red";
  changes = 0;
  set(color: Color): void { if (this.color !== color) this.changes++; this.color = color; }
}
const pieces: string[] = JSON.parse('["am","ber","vio","let","re","d","gre","en","pi","nk"]');
const reversed = (text: string): string => text.split("").reverse().join("");
const joined = (at: number): string => pieces[at] + pieces[at + 1];
const first: string[] = [joined(0), joined(2), joined(4), joined(6), joined(8), ""];
const second: string[] = [reversed("rebma"), reversed("teloiv"), JSON.parse('"red"'), reversed("neerg"), reversed("knip"), pieces[0].slice(2)];
function same(a: Color, b: Color): boolean { return a === b; }
function differs(a: Color, b: Color): boolean { return a !== b; }
function looselySame(a: Color, b: Color): boolean { return a == b; }
function isRed(color: Color): boolean { return color === "red"; }
function isNotGreen(color: Color): boolean { return "green" !== color; }
function letter(color: Color): string {
  switch (color) {
    case "red": return "R";
    case "green": return "G";
    default: return "other:" + color;
  }
}
function pass(color: Color): Color { return color; }
function lamp(color: Color, watts: number): Lamp { return { color, watts }; }
function follow(from: Lamp, to: Lamp): void { to.next = from.color; }
function either(flag: boolean, outside: Color): Color { return flag ? "green" : outside; }

let matrix = "";
for (const a of first) {
  for (const b of second) matrix += same(a as Color, b as Color) ? "1" : differs(a as Color, b as Color) ? "0" : "?";
  matrix += " ";
}
console.log(matrix);
console.log(first.map((a, at) => looselySame(a as Color, second[at] as Color) && Object.is(a, second[at])).join());

const signal = new Signal();
const counts = new Map<Color, number>();
const seen = new Set<Color>();
const byKey: Partial<Record<Color, number>> = {};
const lamps: Lamp[] = [];
for (let round = 0; round < 50; round++) {
  for (let at = 0; at < first.length; at++) {
    const color = (round & 1 ? second : first)[at] as Color;
    signal.set(color);
    counts.set(signal.color, (counts.get(pass(color)) ?? 0) + 1);
    seen.add(color);
    byKey[color] = (byKey[signal.color] ?? 0) + at;
    if (round < 2) lamps.push(lamp(color, at));
  }
}
console.log(signal.color.length, signal.changes, seen.size, [...seen].join(), [...counts].join(";"), JSON.stringify(byKey), Object.keys(byKey).join());
for (let at = 0; at < first.length; at++) {
  const a = lamps[at], b = lamps[at + first.length];
  follow(a, b);
  console.log(
    letter(a.color), isRed(b.color), isNotGreen(a.color), same(a.color, b.color), same(b.next!, b.color), a.next === undefined, typeof a.color, a.color.length,
    `<${b.color}>`, a.color + "|" + b.next, a.color.toUpperCase(), JSON.stringify(b), counts.get(b.color), seen.has(a.color), byKey[b.color],
    either(at > 2, a.color), either(true, a.color) === "green", same(either(false, a.color), b.color), (a as any).color === second[at], a.color.charCodeAt(0),
  );
}
const list = first as Color[];
console.log(second.map(text => list.indexOf(text as Color)).join(), second.map(text => list.includes(text as Color)).join(), [...list].sort().join(), list.lastIndexOf(pass(second[1] as Color)));
const kept = lamps.map(each => each.color);
for (let round = 0; round < 20; round++) new Array(50000).fill(round).map(String);
console.log(kept.join(), kept.filter(color => !isRed(color) && isNotGreen(color)).map(letter).join());
type Pair = "red" | "amber";
function rest(color: Pair): string { return color === "red" ? "r" : color + "!" + JSON.stringify(color) + color.length + `<${color}>` + color.charCodeAt(1); }
console.log(first.map(text => rest(text as Pair)).join(" "), second.map(text => rest(text as Pair)).join(" "));
type Shape = { kind: "circle"; size: number } | { kind: "square"; side: number };
function area(shape: Shape): string { return shape.kind === "circle" ? "circle " + shape.size : shape.kind + " " + shape.side + " " + JSON.stringify(shape); }
console.log(area({ kind: "circle", size: 2 }), area(JSON.parse('{"kind":"' + reversed("erauqs") + '","side":3}') as Shape), area(JSON.parse('{"kind":"' + reversed("elgnairt") + '","side":4}') as Shape));
