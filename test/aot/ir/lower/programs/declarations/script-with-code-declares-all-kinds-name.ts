// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 3

// FILE: main.ts
// What `bun run` drops of a script that has code is global, as for tsc and `bun check`: an interface, a type alias, and `declare function`, `namespace`, `class` and `enum`, whose values its code puts on globalThis. A name that cannot add to what another file has declared stays the script's own: `Node` here, and `Shape` in the second script.
import "./declares";
import "./second";
const shape: Shape = { sides: 4 };
const level: Level = "high";
console.log(shape.sides, level, describe(shape), Units.perMeter, new Meter(2).length, Kind.Second);

// FILE: declares.ts
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

// FILE: second.ts
type Shape = { name: string };
const named: Shape = { name: "its own" };
console.log(named.name);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "auto", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true }, "files": [ "main.ts" ] }
