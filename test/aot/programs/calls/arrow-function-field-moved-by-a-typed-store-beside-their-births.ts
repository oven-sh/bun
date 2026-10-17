// The arrow function of a field is called with the receiver as its `this` only while every instance holds its own closure. Here one instance's closure is put into another by a typed store in the function that makes both, where the compiler may see the closure itself as what is stored. One way a program: the first one ends the fast path for all.
class Context {
  count = 0;
  add = (by: number): number => {
    this.count += by;
    return this.count;
  };
}
class Named extends Context {
  name = "named";
}

function sum(context: Context): number {
  let total = 0;
  for (let i = 0; i < 100; i++) total += context.add(1);
  return total;
}

function move(from: Context, into: Context): void {
  void 0;
}

function moved(): string {
  const from = new Context();
  const into = new Named();
  from.count = 1000;
  into.add = from.add;
  return [sum(into), from.count, into.count, into.add === from.add].join(" ");
}

const own = new Context();
console.log(sum(own), own.count, sum(new Named()));
console.log(moved());
console.log(sum(own), own.count, sum(new Named()));
