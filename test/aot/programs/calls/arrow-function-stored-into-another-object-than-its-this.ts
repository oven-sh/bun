// The one function that a field holds captures `this`, and one of its closures is stored into another object than its `this`: the field is read for the closure, and the call adds to the object that the closure was made in.
// IR= 1 sum PropGet v[0-9]+ name="add"(?!.* isFallback)
// IR= 1 sum GetCapture
class Context {
  count = 0;
  add: (by: number) => number;
  constructor(owner: Context | null) {
    const add = (by: number): number => {
      this.count += by;
      return this.count;
    };
    this.add = add;
    if (owner) owner.add = add;
  }
}

function sum(context: Context): number {
  let total = 0;
  for (let i = 0; i < 100; i++) total += context.add(1);
  return total;
}

const first = new Context(null);
console.log(sum(first), first.count);
const second = new Context(first);
console.log(sum(first), first.count, second.count, first.add === second.add);
console.log(sum(second), first.count, second.count, sum(new Context(null)));
