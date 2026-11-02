// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1

// FILE: main.ts
// Nothing that runs names these constants, classes and enums of two files, so they are left out. The type checker still needs all of them: for contextual types, inferred generics, discriminated unions, mapped and conditional types, overloads picked by a constant's type, a class's private and protected members, an enum as the type of a parameter, and a `unique symbol`.
import type { Remote, RemoteShape } from "./types";
import { remoteDefaults, RemoteKind } from "./types";

const shapes = [{ kind: "circle" as const, radius: 1 }, { kind: "square" as const, side: 2 }];
type Shape = (typeof shapes)[number];
const handlers = { circle: (shape: { radius: number }) => shape.radius, square: (shape: { side: number }) => shape.side };
type Handlers = typeof handlers;
type Results = { [K in keyof Handlers]: ReturnType<Handlers[K]> };
const marker: unique symbol = Symbol("marker");
type Marked = { [marker]: string };
class Account { private balance = 0; protected owner = "nobody"; public id = 1; static count = 0; }
type PublicOfAccount = keyof Account;
enum Step { One, Two, Three }
const tuple = [1, "two", true] as const;
type Second = (typeof tuple)[1];
const pick = <T extends object, K extends keyof T>(object: T, key: K): T[K] => object[key];
type Picked = ReturnType<typeof pick<{ a: number }, "a">>;
const nestedDefaults = { server: { port: 80, tls: { enabled: false } } };
type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle": return shape.radius * 3;
    case "square": return shape.side * shape.side;
  }
}
function name(step: Step): string {
  switch (step) {
    case 0: return "one";
    case 1: return "two";
    default: return "three";
  }
}
const results: Results = { circle: 1, square: 2 };
const key: PublicOfAccount = "id";
const second: Second = "two";
const picked: Picked = 5;
const partial: DeepPartial<typeof nestedDefaults> = { server: { tls: {} } };
const remote: Remote = { url: "u", retries: 2 };
const remoteShape: RemoteShape = "round";
const fromDefaults: typeof remoteDefaults = { url: "v", retries: 3 };
const kind: `${RemoteKind}` = "fast";

console.log(area({ kind: "circle", radius: 2 }), area({ kind: "square", side: 3 }), name(1 as Step), results.square, key, second, picked + 1);
console.log(JSON.stringify(partial), remote.retries + 1, remoteShape, fromDefaults.url, kind);

// FILE: types.ts
export const remoteDefaults = { url: "", retries: 0 };
export type Remote = typeof remoteDefaults;
const remoteShapes = ["round", "flat"] as const;
export type RemoteShape = (typeof remoteShapes)[number];
export enum RemoteKind { Fast = "fast", Slow = "slow" }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: area name
// CHECK-LABEL: function {{*}}name="area"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_3]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="kind"
// CHECK-NEXT: SwitchString v1 strings=["circle", "square"] -> case b2(| 0), case b4(| 0), otherwise b6()
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: v3 = NarrowByField v0, v2 key="kind"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = PropGet v3 key="radius"
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_4]]} illTypedCause=Assertion
// CHECK-NEXT: v6 = Integer integer=3
// CHECK-NEXT: v7 = Mul v5, v6
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: v10 = NarrowByField v0, v9 key="kind"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v11 = PropGet v10 key="side"
// CHECK-NEXT: v12 = Convert v11 declared={type=number site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: v13 = PropGet v10 key="side"
// CHECK-NEXT: v14 = Convert v13 declared={type=number site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: v15 = Mul v12, v14
// CHECK-NEXT: v16 = Convert v15 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Return v16
// CHECK-NEXT: b6():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: v18 = Convert v17 declared={type=number site=[[w_3]]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="name"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=i32 site=[[w_7]]}] results=[{type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: i32):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Switch v0 cases=[0, 1] -> case b2(| 0), case b4(| 0), otherwise b6()
// CHECK-NEXT: b2(v1):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v2 = String string="one"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v5 = String string="two"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: b6():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v7 = String string="three"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
