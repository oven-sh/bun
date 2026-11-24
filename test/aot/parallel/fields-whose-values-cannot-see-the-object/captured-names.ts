function make(outer: number, name: string) {
  let count = 0;
  class Made {
    list = [outer, ++count];
    read = () => outer + count;
    static label = name + outer;
    own = Made.label;
    outer: string;
    count: number;
    constructor(outer: string, count: number, list = outer + count) {
      this.outer = outer;
      this.count = count;
      this.list.push(list.length);
    }
    bump() {
      return ++count + this.read();
    }
  }
  return Made;
}
const First = make(1, "first"), Second = make(20, "second");
for (let i = 0; i < 3; i++) {
  const a = new First("a" + i, i), b = new Second("b" + i, -i);
  console.log(JSON.stringify(a), JSON.stringify(b), a.read(), b.read(), a.bump(), b.bump());
}
const classes: any[] = [];
for (let i = 0; i < 3; i++) {
  const doubled = i * 2;
  classes.push(
    class {
      value = doubled + i;
      get = () => [doubled, i];
      x: number;
      constructor(x: number, doubled = "shadow", i = "other") {
        this.x = x + doubled.length + i.length;
      }
    },
  );
}
for (const It of classes) {
  const it = new It(1);
  console.log(it.value, it.get().join(), it.x, It.name);
}
class Captured {
  early = [tail];
  keep: () => number;
  x: number;
  constructor(x: number, read = () => x) {
    this.keep = read;
    this.x = x;
    x = x + 1;
  }
}
var tail = "t";
const captured = new Captured(4);
console.log(captured.keep(), captured.x, captured.early[0]);
class Shadow {
  x = x;
  y: number;
  constructor(x: number) {
    this.y = x;
  }
}
var x = "module x";
console.log(JSON.stringify(new Shadow(5)));
class Tree {
  children: Tree[] = this_depth() > 2 ? [] : [new Tree(1), new Tree(2)];
  size: number;
  constructor(size: number) {
    this.size = size;
    level--;
  }
}
let level = 0;
function this_depth() {
  return ++level;
}
console.log(JSON.stringify(new Tree(7)), level);
namespace Space {
  export let inner = 3;
  export class In {
    at = inner * 2;
    v: number;
    constructor(v: number) {
      this.v = v;
    }
  }
}
Space.inner = 10;
console.log(JSON.stringify(new Space.In(1)));
enum Color {
  Red = 4,
  Green,
}
class Painted {
  color = Color.Green;
  colors = [Color.Red, Color.Green];
  constructor(public readonly at: Color) {}
}
console.log(JSON.stringify(new Painted(Color.Red)));
