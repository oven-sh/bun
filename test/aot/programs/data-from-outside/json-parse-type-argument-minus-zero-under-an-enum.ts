// -0 where the type is a numeric enum member whose value is 0: it passes, since -0 === 0, and the result holds what the text or the value says. A number that is no member is refused.
import { validate } from "bun:bundle";
enum Color { Red, Green }
interface Painted { color: Color }
type Tagged = { kind: Color.Red; r: number } | { kind: Color.Green; g: string };
function say(run: () => unknown): string {
  try {
    return JSON.stringify(run());
  } catch (error: any) {
    return error.name + (error.issues ? " with " + error.issues.length + " issues" : "");
  }
}
const signOf = (value: number): string => (Object.is(value, -0) ? "-0" : String(value));
for (const zero of ["-0", "-0.0", "-0e1", "0", "0.0"]) {
  console.log(zero + " under a member", say(() => JSON.parse<Painted>('{"color":' + zero + "}").color === Color.Red));
  console.log(zero + " behind white space", say(() => JSON.parse<Painted>('{ "color" : ' + zero + " }").color + 1));
  console.log(zero + " at the root", say(() => JSON.parse<Color>(zero) + 1));
  console.log(zero + " in a list", say(() => JSON.parse<Color[]>("[1," + zero + "]").map(color => color + 1)));
  console.log(zero + " as a tag", say(() => JSON.parse<Tagged>('{"kind":' + zero + ',"r":1}')));
  console.log(zero + " as a tag that comes last", say(() => JSON.parse<Tagged>('{"r":1,"kind":' + zero + "}")));
  console.log(zero + " in a text that is no JSON further on", say(() => JSON.parse<Tagged[]>('[{"kind":' + zero + ',"r":1},{"kind":1.}]')));
  console.log(zero + " keeps its sign", say(() => [JSON.parse<Painted>('{"color":' + zero + "}").color, JSON.parse<Color>(zero), JSON.parse<Color[]>("[1," + zero + "]")[1]!, JSON.parse<Tagged>('{"kind":' + zero + ',"r":1}').kind].map(signOf)));
}
console.log("a value", say(() => validate<Painted>({ color: -0 }).color + 1));
console.log("a value in a list", say(() => validate<Color[]>([-0, 1]).map(color => color + 1)));
console.log("a value keeps its sign", say(() => [validate<Painted>({ color: -0 }).color, validate<Color[]>([-0, 1])[0]!].map(signOf)));
console.log("no member", say(() => JSON.parse<Painted>('{"color":-1}')));

interface Holder { color: Color; colors: Color[]; pair: [Color, number]; byName: Record<string, Color>; maybe?: Color }
const total = (holder: Holder) => holder.color + holder.colors[0]! + holder.pair[0] + holder.byName.a! + (holder.maybe ?? 0) + 1;
const signsOf = (holder: Holder) => [holder.color, holder.colors[0]!, holder.pair[0], holder.byName.a!].map(signOf);
const holders = ['{"color":-0,"colors":[-0,1],"pair":[-0,1],"byName":{"a":-0},"maybe":-0}', '{"color":-0,"colors":[-0,1],"pair":[-0,1],"byName":{"a":-0}}'];
for (const text of holders) {
  console.log("every kind of holder", say(() => total(JSON.parse<Holder>(text))));
  console.log("with an escape in a key", say(() => total(JSON.parse<Holder>(text.replace("colors", "\\u0063olors")))));
  console.log("with a reviver", say(() => total(JSON.parse<Holder>(text, (_, value) => value))));
  console.log("as a value", say(() => total(validate<Holder>(JSON.parse(text)))));
  console.log("the signs", say(() => [signsOf(JSON.parse<Holder>(text)), signsOf(JSON.parse<Holder>(text, (_, value) => value)), signsOf(validate<Holder>(JSON.parse(text)))]));
  console.log("written again", say(() => JSON.parse<Holder>(text)));
}
const values: unknown[] = [{ color: -0 }, [-0, 1], [-0, 2], { a: -0 }];
console.log("an object made elsewhere", say(() => validate<Painted>(values[0]).color + 1));
console.log("a list made elsewhere", say(() => validate<Color[]>(values[1]).map(color => color + 1)));
console.log("a tuple made elsewhere", say(() => validate<[Color, number]>(values[2])[0] + 1));
console.log("a dictionary made elsewhere", say(() => validate<Record<string, Color>>(values[3]).a! + 1));
console.log("the values are as they were", Object.is((values[0] as Painted).color, -0), Object.is((values[1] as number[])[0], -0), Object.is((values[2] as number[])[0], -0));
