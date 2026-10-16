// `this.step = ..` where `step` is a method of the class: the objects have a field for it and the method stays fixed. A method that nobody stores to has no field, and one that is stored to through a variable is looked for by name.
// IR+ ^  field "step" .* flags
// IR+ ^  method "step" Method f[0-9]+$
// IR- ^  method "step" Method f[0-9]+ replaced$
// IR- ^  field "untouched"
// IR+ ^  method "untouched" Method f[0-9]+$
// IR- ^  field "patched"
// IR+ ^  method "patched" Method f[0-9]+ replaced$
declare const console: any;
class Walker {
  total = 0;
  walk(by: number): void { this.step(by); }
  step(by: number): void { this.total += by; }
  untouched(): number { return this.total; }
  patched(): number { return 1; }
}
class Doubling extends Walker {
  constructor(twice: boolean) {
    super();
    if (twice) this.step = function (this: Doubling, by: number) { this.total += by * 2; };
  }
}
const walkers: Walker[] = [new Walker(), new Doubling(false), new Doubling(true)];
walkers[0].patched = () => 2;
let sum = 0;
for (let i = 0; i < 3_000_000; i++) { const walker = walkers[i % 3]; walker.walk(1); sum = (sum + walker.untouched() + walker.patched()) | 0; }
console.log(sum, walkers.map(walker => walker.total + ":" + Object.keys(walker).join()).join(" "));
export {};
