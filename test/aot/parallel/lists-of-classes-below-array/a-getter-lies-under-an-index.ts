// An accessor under an index of the object, and one under an index of the class's prototype behind a hole: each read runs it, in the order of the places.
class Row extends Array<unknown> {}
function three(list: Iterable<unknown>): string { const [a, b, c] = list; return [a, b, c].map(String).join(); }
function all(list: Iterable<unknown>): string { return [...list].map(String).join(); }
const log: string[] = [];
const own = new Row(); own.push(1, 2, 3);
const holed = new Row(); holed.length = 3; holed[0] = "zero";
const said: string[] = [];
for (let i = 0; i < 300; i++) {
  if (i === 100) Object.defineProperty(own, 1, { configurable: true, get() { log.push("own"); return "got"; } });
  if (i === 100) Object.defineProperty(Row.prototype, 2, { configurable: true, get() { log.push("above"); return "high"; } });
  if (i === 200) { Object.defineProperty(own, 1, { value: 2, writable: true, configurable: true, enumerable: true }); delete (Row.prototype as any)[2]; }
  const line = [three(own), all(own), three(holed), all(holed), log.length].join(" ");
  if (i % 100 === 0 || i % 100 === 99) said.push(line);
}
console.log(said.join("\n"), log.slice(0, 6).join());
