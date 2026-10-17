// calls an arrow function that is a field of a class, outside loops
const operations = 4;
class Context {
  count = 0;
  add = (by: number): number => {
    this.count += by;
    return this.count;
  };
}
let context: Context = new Context();
let total = 0;

kernel: {
  total += context.add(1);
  total += context.add(2);
  total += context.add(3);
  total += context.add(4);
}

console.log(total);
