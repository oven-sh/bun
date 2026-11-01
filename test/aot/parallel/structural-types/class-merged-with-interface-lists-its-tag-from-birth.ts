// The tag that the constructor of a class merged with an interface stores is listed from birth, before and after a field is added.
interface Base {
  kind: 1 | 2;
}
interface A extends Base {
  kind: 1;
  a: number;
}
interface B extends Base {
  kind: 2;
  b: number;
}
interface N extends Base {}
class N {
  constructor(kind: 1 | 2) {
    this.kind = kind;
  }
}
const x = new N(1) as unknown as A;
console.log("born:", Object.keys(x).join());
x.a = 5;
console.log("after a:", Object.keys(x).join());
const y = new N(2) as unknown as B;
y.b = 6;
console.log(Object.keys(y).join());
