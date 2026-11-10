const above: any = {};
const texts = JSON.parse('["1", "{", "[2]", "]"]');
let at = 0;
Object.defineProperty(above, "parsed", { get() { return JSON.parse(texts[at++ % 4]); }, configurable: true });
const orchard: any = Object.create(above);
function look(from: any, whole: number): string {
  const a = whole * 7 + 3;
  let seen: unknown;
  try { seen = JSON.stringify(from.parsed); } catch (error: any) { seen = error.constructor.name; }
  return seen + " " + a;
}
const turns = JSON.parse("8");
for (let t = 0; t < turns; t++) console.log(look(orchard, t));
console.log("after", at);
