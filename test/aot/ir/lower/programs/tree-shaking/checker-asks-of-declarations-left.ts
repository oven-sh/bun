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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = PropGet v0 key="kind"
// CHECK-NEXT: SwitchString v1 strings=["circle", "square"] -> case b1(| 0), case b2(| 0), otherwise b3()
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = NarrowByField v0, v2 key="kind"
// CHECK-NEXT: v4 = PropGet v3 key="radius"
// CHECK-NEXT: v5 = Integer integer=3
// CHECK-NEXT: v6 = Mul v4, v5
// CHECK-NEXT: v7 = Convert v6 declared={type=number}
// CHECK-NEXT: Return v7
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = NarrowByField v0, v8 key="kind"
// CHECK-NEXT: v10 = PropGet v9 key="side"
// CHECK-NEXT: v11 = PropGet v9 key="side"
// CHECK-NEXT: v12 = Mul v10, v11
// CHECK-NEXT: v13 = Convert v12 declared={type=number}
// CHECK-NEXT: Return v13
// CHECK-NEXT: b3():
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: v15 = Convert v14 declared={type=number}
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="name"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=i32}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: i32):
// CHECK-NEXT: Switch v0 cases=[0, 1] -> case b1(| 0), case b2(| 0), otherwise b3()
// CHECK-NEXT: b1(v1):
// CHECK-NEXT: v2 = String string="one"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = String string="two"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: b3():
// CHECK-NEXT: v7 = String string="three"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
