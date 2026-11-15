// The prototype of the object is replaced: by an object with an iterator, by a proxy that sees every read, by null, by Array.prototype itself.
class Row extends Array<number> {}
function two(list: Iterable<number>): string { try { const [a, b] = list; return a + "," + b; } catch (error) { return (error as Error).constructor.name; } }
function all(list: Iterable<number>): string { try { return [...list].join(); } catch (error) { return (error as Error).constructor.name; } }
const make = () => { const row = new Row(); row.push(1, 2, 3); return row; };
const other = make(), watched = make(), bare = make(), direct = make(), kept = make();
const seen: string[] = [];
const said: string[] = [];
for (let i = 0; i < 200; i++) {
  if (i === 100) {
    Object.setPrototypeOf(other, { *[Symbol.iterator]() { yield 9; yield 8; } });
    Object.setPrototypeOf(watched, new Proxy(Row.prototype, { get(target, key, receiver) { seen.push(String(key)); return Reflect.get(target, key, receiver); } }));
    Object.setPrototypeOf(bare, null);
    Object.setPrototypeOf(direct, Array.prototype);
  }
  const line = [two(other), all(other), two(watched), all(watched), two(bare), all(bare), two(direct), all(direct), two(kept), seen.length].join(" ");
  if (i % 100 === 0 || i % 100 === 99) said.push(line);
}
console.log(said.join("\n"), seen.slice(0, 3).join());
