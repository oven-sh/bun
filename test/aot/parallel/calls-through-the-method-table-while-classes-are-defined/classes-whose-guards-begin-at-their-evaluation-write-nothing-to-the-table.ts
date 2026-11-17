// The guards of One begin when the class is evaluated (a static member under a computed key). The words of the method table hold the compiled methods from the start, so nothing is written when the guards begin.
// COUNT: counter:MethodTablePagesMadeWritable = 0
class Shape {
  edge = 2;
  area(k: number): number { return this.edge * k; }
  around(k: number): number { return this.edge * 4 + this.area(k); }
}
class One extends Shape {
  static [Symbol.for("tag")]() { return 1; }
  area(k: number): number { return this.edge * k * 2; }
}
class Two extends Shape {
  static [Symbol.for("tag")]() { return 2; }
  area(k: number): number { return this.edge * k * 3; }
}
(globalThis as any).kept = [Shape, One, Two];
function measure(s: Shape): number { return s.area(1) + s.around(1); }
console.log(measure(new Shape()), measure(new One()), measure(new Two()));
export {};
