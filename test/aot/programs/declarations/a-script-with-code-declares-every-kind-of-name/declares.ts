interface Shape {
  sides: number;
}
type Level = "low" | "high";
type Node = { own: number };
declare function describe(shape: Shape): string;
declare namespace Units {
  const perMeter: number;
}
declare class Meter {
  constructor(length: number);
  length: number;
}
declare enum Kind {
  First,
  Second,
}
const node: Node = { own: 1 };
const everything = globalThis as any;
everything.describe = (shape: Shape) => shape.sides + " sides, " + node.own;
everything.Units = { perMeter: 100 };
everything.Meter = class {
  constructor(public length: number) {}
};
everything.Kind = { First: 0, Second: 1 };
