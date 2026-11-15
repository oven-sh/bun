// A hole inside the length is read through the prototypes: an index on the class's prototype answers for it. Behind the length nothing is read.
class Row extends Array<unknown> {}
function three(list: Iterable<unknown>): string { const [a, b, c] = list; return [a, b, c].map(String).join(); }
function all(list: Iterable<unknown>): string { return [...list].map(String).join(); }
const holed = new Row(); holed.length = 3; holed[0] = "zero"; holed[2] = "two";
const short = new Row(); short.push("only");
const whole = new Row(); whole.push(1, 2, 3);
const said: string[] = [];
for (let i = 0; i < 300; i++) {
  if (i === 100) (Row.prototype as any)[1] = "above";
  if (i === 200) delete (Row.prototype as any)[1];
  const line = [three(holed), all(holed), three(short), all(short), three(whole)].join(" ");
  if (i % 100 === 0 || i % 100 === 99) said.push(line);
}
console.log(said.join("\n"));
