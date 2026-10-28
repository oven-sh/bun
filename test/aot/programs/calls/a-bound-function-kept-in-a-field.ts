// A field of a function type is stored what Function.prototype.bind returns, which is a function and none of the program's. The objects are handed to code that the build cannot see,
// so nothing is proven about the field. It stays in its slot all the same, in the instance of a class and in a literal. The output is that of plain Bun.
// COUNTER: FieldsLeftSlotByStoreOfOtherType = 0
type Callback = (value: number) => number;
const double: Callback = value => value * 2;
const triple: Callback = value => value * 3;
function add(this: { base: number }, value: number): number {
  return this.base + value;
}
class Holder {
  callback: Callback;
  other: Callback;
  constructor(base: number, other: Callback) {
    this.callback = add.bind({ base });
    this.other = other;
  }
}
const literal = (base: number): { callback: Callback } => ({ callback: add.bind({ base }) });
const seenByNobody: any = (globalThis as any)[process.argv[2] ?? "nothing of that name"];
let sum = 0;
for (let i = 0; i < 1000; i++) {
  const holder = new Holder(i, i & 1 ? double : triple);
  const made = literal(i);
  if (seenByNobody) seenByNobody(holder, made);
  sum += holder.callback(1) + holder.other(2) + made.callback(3);
}
console.log(sum);
