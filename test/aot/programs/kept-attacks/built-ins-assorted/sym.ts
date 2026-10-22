// Built ins assorted, one probe of many. It prints what plain Bun prints.
const kState: unique symbol = Symbol("kState");
class Holder {
  [kState]: number = 1;
  bump(): number {
    return ++this[kState];
  }
}
const holder = new Holder();
let sum = 0;
for (let i = 0; i < Number(process.argv[2] ?? 3); ++i) sum += holder.bump();
console.log(sum);
