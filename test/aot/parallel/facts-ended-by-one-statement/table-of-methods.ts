abstract class Node2 {
  abstract value(): number;
  name() {
    return "node";
  }
}
class Num extends Node2 {
  constructor(public n: number) {
    super();
  }
  value() {
    return this.n;
  }
}
class Add extends Node2 {
  constructor(
    public a: Node2,
    public b: Node2,
  ) {
    super();
  }
  value(): number {
    return this.a.value() + this.b.value();
  }
  name() {
    return "add";
  }
}
class Mul extends Node2 {
  constructor(
    public a: Node2,
    public b: Node2,
  ) {
    super();
  }
  value(): number {
    return this.a.value() * this.b.value();
  }
}
class Neg extends Node2 {
  constructor(public a: Node2) {
    super();
  }
  value(): number {
    return -this.a.value();
  }
  name() {
    return "neg";
  }
}
class Max extends Node2 {
  constructor(public list: Node2[]) {
    super();
  }
  value(): number {
    let m = -Infinity;
    for (const n of this.list) m = Math.max(m, n.value());
    return m;
  }
}
function build(d: number): Node2 {
  return d === 0
    ? new Num(3)
    : d % 4 === 0
      ? new Add(build(d - 1), new Num(d))
      : d % 4 === 1
        ? new Mul(build(d - 1), new Num(2))
        : d % 4 === 2
          ? new Neg(build(d - 1))
          : new Max([build(d - 1), new Num(1)]);
}
const nodes = Array.from({ length: 9 }, (_, i) => build(i));
function total(): string {
  let sum = 0,
    text = "";
  for (let i = 0; i < 3; i++)
    for (const n of nodes) {
      sum += n.value();
      text += n.name()[0];
    }
  return sum + text;
}
console.log(total());
(Mul.prototype as any).value = () => 1000;
(nodes[2] as any).name = () => "own";
console.log(total());
