const out: string[] = [];
const show = (v: unknown): string => Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : v instanceof Error ? v.name + " " + v.message : String(v);
let asked = 0;
class Cell { n = 0; add(by: number): void { this.n += by; if (this.n > 1e12) this.n = 0; } get twice(): number { return this.n * 2; } }
const cell = new Cell();
const table = [5, 1, 7, 3, 2, 9, 4, 6];
const noisy = (value: unknown) => ({ valueOf() { asked++; return value; } });
const integers: number[] = JSON.parse("[0,1,2,3,-1,-7,63,64,127,128,2147483647,-2147483648,12345]");
const doubles: number[] = JSON.parse("[0.5,1.75,-0.5,-1.5,2147483648,4294967295,4294967296,4294967301.75,-2147483649,9007199254740993,1e21,-1e300]").concat([NaN, Infinity, -Infinity, -0]);
const mixed: number[] = [1, 2.5, 3, -4.5];
const holes: number[] = [1, 2, 3, 4, 5]; delete holes[2];
const strange = [1, "7", null, undefined, true, noisy(6), noisy("9"), [4], 8] as unknown as number[];
const throwing = [1, { valueOf() { throw new RangeError("value"); } }, 3] as unknown as number[];
const large = [1, 10n, 3] as unknown as number[];
function masks(list: number[]): string {
  let total = 0;
  for (let k = 0; k < list.length; k++) { cell.add((list[k] & 63) + 1); if ((list[k] & 1) === 1) total++; }
  return total + " " + cell.n;
}
function each(list: number[]): string {
  const kept: number[] = [];
  for (let k = 0; k < list.length; k++) {
    cell.n = list[k] | 0; kept.push(cell.n);
    cell.n = list[k] >>> 0; kept.push(cell.twice);
    cell.n = ~list[k]; kept.push(cell.n);
    cell.n = list[k] >> 2; kept.push(cell.n);
    cell.n = list[k] << 3; kept.push(cell.n);
    cell.n = 1 << list[k]; kept.push(cell.n);
    cell.n = list[k] ^ k; kept.push(cell.n);
  }
  return kept.map(show).join();
}
function both(list: number[]): string {
  let hash = 0x811c9dc5 | 0, sum = 0;
  for (let k = 0; k < list.length; k++) { hash = Math.imul(hash ^ list[k], 0x01000193); cell.add(table[list[k] & 7]); sum += list[k]; cell.add((list[k] & 15) + (list[k] >> 4)); }
  return hash + " " + show(sum) + " " + cell.n;
}
function edges(list: number[]): string {
  let total = 0;
  for (let k = -1; k < list.length + 2; k++) { cell.add((list[k] & 31) + 1); total += (list[k + 1] | 0) % 7; }
  return total + " " + cell.n;
}
function widened(list: number[]): string {
  let total = 0;
  for (let k = 0; k < list.length; k++) { cell.add((list[k] & 255) + 1); if (k === 1) list[list.length - 1] = 0.5 + k; if (k === 2) (list as unknown[])[list.length - 1] = "77"; total = total + (list[list.length - 1] & 127) | 0; }
  return total + " " + cell.n;
}
function attempt(name: string, run: () => string): void { cell.n = 0; try { out.push(name + " " + run()); } catch (error) { out.push(name + " threw " + show(error) + " " + cell.n); } out.push("asked " + asked); }
for (let round = 0; round < 2; round++) {
  for (const [name, list] of [["integers", integers], ["doubles", doubles], ["mixed", mixed], ["holes", holes], ["strange", strange], ["throwing", throwing], ["large", large], ["none", []]] as [string, number[]][]) {
    for (const [form, run] of [["masks", masks], ["each", each], ["both", both], ["edges", edges]] as [string, (list: number[]) => string][]) attempt(name + " " + form, () => run(list));
    attempt(name + " widened", () => widened([...list]));
  }
}
console.log(out.join("\n"));
