// A union with a tag, instanceof and `in`.
// Sizes: 250 1000 4000
// Passes: 2400
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
type Shape = { kind: "disc"; r: number } | { kind: "box"; w: number; h: number } | { kind: "dot" };
class Odd {
  constructor(public n: number) {}
}
function area(shape: Shape): number {
  switch (shape.kind) {
    case "disc":
      return shape.r * 3;
    case "box":
      return shape.w * shape.h;
    default:
      return 1;
  }
}
function judge(x: Shape | Odd): number {
  return x instanceof Odd ? x.n : "r" in x ? 2 : area(x);
}
function once(): string {
  const all: (Shape | Odd)[] = [];
  for (let i = 0; i < size * 2; i++)
    all.push(
      i % 4 === 0
        ? { kind: "disc", r: i & 7 }
        : i % 4 === 1
          ? { kind: "box", w: 2, h: i & 3 }
          : i % 4 === 2
            ? { kind: "dot" }
            : new Odd(i & 15),
    );
  let sum = 0;
  for (const x of all) sum += judge(x);
  return [sum].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
