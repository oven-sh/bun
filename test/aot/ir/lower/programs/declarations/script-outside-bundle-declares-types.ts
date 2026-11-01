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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v2 = Data data=[[d_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Array<undefined|null|[[L_3]]> site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v4 = Builtin builtin=GlobalThis
// CHECK-NEXT: v5 = PropGet v4 key="console" [isFreeName]
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v6 key="log"
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v9 = Integer
// CHECK-NEXT: v10 = ElemGet v3, v9
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[L_3]]} illTypedCause=Assertion
// CHECK-NEXT: v12 = Call v1, -, v11 calleeName="sum"
// CHECK-NEXT: v13 = Convert v12 declared={type=number site=[[w_5]]}
// CHECK-NEXT: v14 = Integer integer=1
// CHECK-NEXT: v15 = ElemGet v3, v14
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[L_3]]} illTypedCause=Assertion
// CHECK-NEXT: v17 = Call v1, -, v16 calleeName="sum"
// CHECK-NEXT: v18 = Convert v17 declared={type=number site=[[w_6]]}
// CHECK-NEXT: v19 = Builtin builtin=GlobalThis
// CHECK-NEXT: v20 = PropGet v19 key="BUILD_LABEL" [isFreeName, isForTypeOf]
// CHECK-NEXT: v21 = TypeOf v20
// CHECK-NEXT: v22 = Call v8, v6, v13, v18, v21 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v23 = Undefined
// CHECK-NEXT: Return v23
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sum"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_3]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_8]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_3]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="x"
// CHECK-NEXT: v2 = PropGet v0 key="y"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_8]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
