// One text of a class, evaluated many times, under keys of the module.
const tag: unique symbol = Symbol("tag");
const label = "label";
interface Tagged { [tag](): number; label(): string; n: number }
function family(n: number): new () => Tagged {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return class { n = n + work; [tag]() { return this.n * 2; } [label]() { return "l" + this.n; } };
}
function sum(list: Tagged[]): string {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let total = work, text = "";
  for (let i = 0; i < list.length; i++) { total = (total + list[i][tag]()) | 0; text = list[i].label(); }
  return total + text;
}
const list: Tagged[] = [];
const made = [family(1), family(2), family(3)];
for (let i = 0; i < 600; i++) list.push(new made[i % 3]());
console.log(sum(list));
(made[1].prototype as any)[tag] = function () { return -1; };
console.log(sum(list));
delete (made[2].prototype as any)[label];
try { console.log(sum(list)); } catch (e) { console.log((e as Error).name); }
