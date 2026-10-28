// What is not made until it is read is there all the same for code without types: by name, by key, `in`, hasOwn, the lists of keys and values.
// CALLS- Panel NewTypedClosure
import * as records from "./reader-of-records.js";
import * as panels from "./reader-of-panels.js";
import * as sealedPanels from "./reader-of-sealed-panels.js";
interface Kit { kind: "kit"; n: number; add: (x: number) => number; twice?: (x: number) => number; thrice?: (x: number) => number; never?: () => number; }
function makeKit(n: number): Kit { return { kind: "kit", n, add: x => x + 1, twice: x => x * 2, thrice: x => x * 3 }; }
class Panel { n: number; wide = 1; add = (x: number) => x + this.n; twice = (x: number) => x * 2; thrice = (x: number) => x * 3 + this.n; constructor(n: number) { this.n = n & 1; } }
class Sealed { n: number; label = "s"; add = (x: number) => x + this.n; twice = (x: number) => x * 2; thrice = (x: number) => x * 3; constructor(n: number) { this.n = n & 1; } }
Object.freeze(Object.getPrototypeOf(new Sealed(0)));
const keys = ["add", "thrice", "twice"];
function tell(label: string, totals: number[], list: string) { console.log(label, totals.join(), list); }
{
  const totals = [0, 0, 0, 0, 0]; let list = "";
  for (let i = 0; i < 300; i++) {
    totals[0] += records.readOne(makeKit(i), "add"); totals[1] += records.readOne(makeKit(i), keys[i % 3]); totals[2] += records.callOne(makeKit(i), i); totals[3] += records.hasOne(makeKit(i), keys[i % 3]) + records.hasOne(makeKit(i), "never");
    totals[4] += records.readOne(Object.freeze(makeKit(i)), keys[i % 3]); list = records.listOne(makeKit(i)); totals[0] += records.copyOne(makeKit(i));
  }
  tell("record", totals, list);
}
{
  const totals = [0, 0, 0, 0]; let list = "";
  for (let i = 0; i < 300; i++) {
    totals[0] += panels.readOne(new Panel(i), "add"); totals[1] += panels.readOne(new Panel(i), keys[i % 3]); totals[2] += panels.callOne(new Panel(i), i); totals[3] += panels.hasOne(new Panel(i), keys[i % 3]) + panels.hasOne(new Panel(i), "never");
    list = panels.listOne(new Panel(i)); totals[0] += panels.copyOne(new Panel(i));
  }
  tell("class", totals, list);
}
{
  const totals = [0, 0, 0, 0]; let list = "";
  for (let i = 0; i < 300; i++) {
    totals[0] += sealedPanels.readOne(new Sealed(i), "add"); totals[1] += sealedPanels.readOne(new Sealed(i), keys[i % 3]); totals[2] += sealedPanels.callOne(new Sealed(i), i); totals[3] += sealedPanels.hasOne(new Sealed(i), keys[i % 3]) + sealedPanels.hasOne(new Sealed(i), "never");
    list = sealedPanels.listOne(new Sealed(i)); totals[0] += sealedPanels.copyOne(new Sealed(i));
  }
  tell("class with a frozen prototype", totals, list);
}
