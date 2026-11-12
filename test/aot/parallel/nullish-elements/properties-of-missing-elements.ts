// Properties of the elements of a list in loops, where an element is missing: undefined, null, a hole, beyond the end, or no record at all. The message and the sums around it are as written.
class Item { constructor(public x: number, public y: number) {} sum(): number { return this.x + this.y; } }
class Other extends Item { z = 4; sum(): number { return this.x - this.z; } }
function make(n: number): Item[] { const made: Item[] = []; for (let i = 0; i < n; i++) made.push(new Item(i, 10 - i)); return made; }
const lists: [string, Item[]][] = [];
function keep(name: string, change: (list: Item[]) => void): void { const list = make(9); change(list); lists.push([name, list]); }
keep("records", () => {});
keep("undefined", list => { (list as (Item | undefined)[])[5] = undefined; });
keep("null", list => { (list as (Item | null)[])[6] = null; });
keep("hole", list => { delete list[4]; });
keep("short", list => { list.length = 6; });
keep("classes", list => { list[2] = new Other(7, 8); list[7] = new Other(1, 2); });
function read(list: Item[]): number { let s = 0; for (let i = 0; i < 9; i++) s += list[i]!.x * 3 + list[i]!.y; return s; }
function write(list: Item[]): number { let s = 0; for (let i = 8; i >= 0; i--) { list[i]!.x = i; s += list[i]!.x; } return s; }
function walk(list: Item[]): number { let s = 0; for (const item of list) { s += item.x; item.y++; s += item.y & 1; } return s; }
function call(list: Item[]): number { let s = 0; for (let i = 0; i < 9; i += 2) s += list[i]!.sum(); return s; }
function take(list: Item[]): number { let s = 0; for (const { x, y } of list) s += x - y; return s; }
function careful(list: Item[]): number { let s = 0; for (let i = 0; i < 12; i++) { const item = list[i]; s += item === undefined || item === null ? 100 : item.x; } return s; }
const forms: [string, (list: Item[]) => number][] = [["read", read], ["write", write], ["walk", walk], ["call", call], ["take", take], ["careful", careful]];
for (let t = 0; t < 40; t++) {
  for (const [name, list] of lists) {
    for (const [form, run] of forms) {
      let said: string;
      try { said = String(run(list)); } catch (error) { said = (error as Error).constructor.name; }
      if (t === 39) console.log(name, form, said);
    }
  }
}
export {};
