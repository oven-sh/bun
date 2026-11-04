// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1

// FILE: main.ts
// A .ts file without import or export is a script unless the project says `moduleDetection: force`: what it declares is global, as for tsc and `bun check`, also where nothing imports it.
const pair: Pair = [
  { x: 1, y: 2 },
  { x: 3, y: 4 },
];
function sum(point: Point): number {
  return point.x + point.y;
}
console.log(sum(pair[0]), sum(pair[1]), typeof BUILD_LABEL);
export {};

// FILE: globals.ts
interface Point {
  x: number;
  y: number;
}
type Pair = [Point, Point];
declare const BUILD_LABEL: string | undefined;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "auto", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true }, "files": [ "main.ts", "globals.ts" ] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]}
// CHECK-NEXT: v2 = Data data=[[d_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Array<undefined|null|[[L_3]]> flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v4 = Builtin builtin=GlobalThis
// CHECK-NEXT: v5 = PropGet v4 key="console" [isFreeName]
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v6 key="log"
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v9 = Integer
// CHECK-NEXT: v10 = ElemGet v3, v9
// CHECK-NEXT: v11 = Call v1, -, v10 calleeName="sum"
// CHECK-NEXT: v12 = Integer integer=1
// CHECK-NEXT: v13 = ElemGet v3, v12
// CHECK-NEXT: v14 = Call v1, -, v13 calleeName="sum"
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="BUILD_LABEL" [isFreeName, isForTypeOf]
// CHECK-NEXT: v17 = TypeOf v16
// CHECK-NEXT: v18 = Call v8, v6, v11, v14, v17 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sum"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_3]]):
// CHECK-NEXT: v1 = PropGet v0 key="x"
// CHECK-NEXT: v2 = PropGet v0 key="y"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
