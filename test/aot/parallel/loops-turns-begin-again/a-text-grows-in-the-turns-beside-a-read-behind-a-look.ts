// One shape. A loop is built twice, and a text grows in its turns: it goes round in a string builder, and with a text in a builder no turn begins again in the other copy.
// What nobody has seen is done by eval: an accessor laid over a field.
type Box = { x: number };
let reads = 0;
function grows(o: Box, n: number): string {
  let text = "a";
  for (let i = 0; i < n; i++) {
    if (o.x === i) break;
    text = text + "b";
  }
  return text;
}
(globalThis as any).entries = [grows];
(globalThis as any).noteRead = () => { reads++; };
const plain: Box = { x: 5 };
(globalThis as any).first = plain;
console.log(grows(plain, 9), grows({ x: 50 }, 3));
console.log(grows((0, eval)("({ get x() { noteRead(); return 4; } })"), 9), reads);
