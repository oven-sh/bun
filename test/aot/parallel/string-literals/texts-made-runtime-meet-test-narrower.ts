// A field of a union of texts is read and stored, under `as`, into a field of a narrower union. What arrives: the texts of both unions, made by a parser, by joining pieces and by cutting a longer text; a text of the wider union alone; a text of neither; 16-bit texts; the empty text
type Color = "red" | "green" | "blue";
type Warm = "red" | "green";
class Light { color: Color; constructor(color: Color) { this.color = color; } }
class Lamp { color: Warm = "red"; stores = 0; }
const never = Date.now() < 0;
const pieces: string[] = JSON.parse('["re","d","gre","en","bl","ue","vio","let"]');
const long: string = never ? "" : pieces.join("-") + "-redgreenblue";
const made: string[] = [
  "red", "green", "blue", JSON.parse('"red"'), JSON.parse('"green"'), JSON.parse('"blue"'),
  pieces[0] + pieces[1], pieces[2] + pieces[3], pieces[4] + pieces[5], pieces[6] + pieces[7],
  long.slice(-12, -9), long.slice(-9, -4), long.slice(-4), long.slice(0, 2), "", "réd", "紅", ("red紅").slice(0, 3), ("紅green").slice(1),
];
function copy(to: Lamp, from: Light): void { to.color = from.color as Warm; to.stores++; }
function isWarm(color: Warm): number { return color === "red" ? 1 : color === "green" ? 2 : 3; }
function pass(from: Light): number { return isWarm(from.color as Warm); }
function letterOf(color: Color): string { switch (color) { case "red": return "R"; case "green": return "G"; case "blue": return "B"; } return "?"; }
const lamp = new Lamp();
for (let round = 0; round < 200; round++) {
  let line = "";
  for (const text of made) {
    const light = new Light(text as Color);
    copy(lamp, light);
    line += lamp.color + ":" + lamp.color.length + ":" + pass(light) + ":" + letterOf(light.color) + ":" + (lamp.color === text) + " ";
  }
  if (round % 99 === 0) console.log(round, lamp.stores, line);
}
