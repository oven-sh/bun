// Made by test/aot/tools/generate-calls-through-the-method-table-while-classes-are-defined.py.
const said: string[] = [];
const unseen = (0, eval);
const one: number = +process.argv[2] || 1;
class Shape {
  edge = 2;
  area(k: number): number { return this.edge * k; }
  around(k: number): number { return this.edge * 4 + this.area(k); }
}
class Disk extends Shape {
  area(k: number): number { return this.edge * k * 3; }
}
class Other {
  edge = 5;
  area(k: number): number { return 1000 + k; }
  around(k: number): number { return 2000 + k; }
}
function measure(s: Shape): number { return s.area(1) + s.around(1); }
function attempt(work: () => unknown): void {
  try {
    said.push(String(work()));
  } catch (error: any) {
    said.push("thrown: " + error.name);
  }
}
attempt(() => measure(new Shape()) + " " + measure(new Disk()));
class Late extends Shape {
  late = 4;
  ["ta" + "g"]() { return 1; }
  [(attempt(() => measure(new (Late as any)())), "extra")]() { return 2; }
  area(k: number): number { return this.edge * k * 5; }
}
attempt(() => measure(new Late()));
console.log(said.join("\n"));
export {};
