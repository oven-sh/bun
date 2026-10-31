// A text from outside the program that equals a member of a union which no code spells is stored into a typed field, read, compared, switched on and passed on, a million times. The first argument names another text
type Color = "red" | "amber" | "green" | "violet";
class Signal { color: Color = "red"; }
class Tally { red = 0; green = 0; other = 0; length = 0; same = 0; }
const given: string = process.argv[2] ?? JSON.parse('["am","ber"]').join("");
const texts: string[] = [];
for (let at = 0; at < 8; at++) texts.push(JSON.parse(JSON.stringify(given)));
function weigh(color: Color): number {
  switch (color) {
    case "red": return 1;
    case "green": return 2;
    default: return 3;
  }
}
function step(signal: Signal, tally: Tally, text: string, previous: Color): Color {
  signal.color = text as Color;
  const color = signal.color;
  if (color === "red") tally.red++;
  else if (color === "green") tally.green++;
  else tally.other++;
  tally.length += weigh(color);
  if (color === previous) tally.same++;
  return color;
}
const signal = new Signal();
const tally = new Tally();
let previous: Color = "red";
for (let round = 0; round < 1_000_000; round++) previous = step(signal, tally, texts[round & 7], previous);
console.log(tally.red, tally.green, tally.other, tally.length, tally.same, previous.length);
