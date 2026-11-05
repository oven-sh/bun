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

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v2 = String string="high"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|"high"|"low" site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v4 = Builtin builtin=GlobalThis
// CHECK-NEXT: v5 = PropGet v4 key="console" [isFreeName]
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v6 key="log"
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v1 key="sides"
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="describe" [isFreeName]
// CHECK-NEXT: v12 = Call v11, -, v1 calleeName="describe"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v14 = Builtin builtin=GlobalThis
// CHECK-NEXT: v15 = PropGet v14 key="Units" [isFreeName]
// CHECK-NEXT: v16 = PropGet v15 key="perMeter"
// CHECK-NEXT: v17 = Builtin builtin=GlobalThis
// CHECK-NEXT: v18 = PropGet v17 key="Meter" [isFreeName]
// CHECK-NEXT: v19 = Integer integer=2
// CHECK-NEXT: v20 = Construct v18, -, v19 calleeName="Meter"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|string|[[L_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v22 = PropGet v21 key="length"
// CHECK-NEXT: v23 = Builtin builtin=GlobalThis
// CHECK-NEXT: v24 = PropGet v23 key="Kind" [isFreeName]
// CHECK-NEXT: v25 = PropGet v24 key="Second"
// CHECK-NEXT: v26 = Call v8, v6, v9, v3, v13, v16, v22, v25 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v27 = Undefined
// CHECK-NEXT: Return v27
// CHECK-NEXT: }
