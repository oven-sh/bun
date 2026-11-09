// Objects of classes below Array are taken apart by patterns and spreads. Nothing above them but Array.prototype has an iterator, so what is read is what the lists' own iteration hands out.
class Row extends Array<number> { firstTwo(): number { const [a, b] = this; return a! + b!; } lastOfThree(): number { const [, , c = 7] = this; return c; } }
class Wider extends Row { tag = "w"; four(): string { const [a, b, c, d] = this; return [a, b, c, d].join(); } }
function count(...values: unknown[]): number { return values.length; }
const row = new Row(); row.push(1, 2, 3);
const short = new Row(); short.push(4, 5);
const none = new Row();
const wider = new Wider(); wider.push(1.5, 2.5, 3.5, 4.5, 5.5);
const texts = new (class Names extends Array<string> {})(); texts.push("a", "b");
let sum = 0;
const said: string[] = [];
for (let i = 0; i < 300; i++) {
  sum += row.firstTwo() + row.lastOfThree() + short.firstTwo() + short.lastOfThree() + none.lastOfThree() + count(...row) + count(...wider, ...short) + [...none, ...row].length;
  const [x, y, z] = texts;
  if (i % 100 === 0) said.push(wider.four(), String(none.firstTwo()), [x, y, z].join(), [...wider].constructor.name, String(wider.firstTwo()));
}
console.log(sum, said.join(" "));
