// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 7

// FILE: main.ts
// The classes come through the barrel of a pure package written in TypeScript, and this file writes them only as types: of a decorated constructor's parameters, of a decorated property, through a namespace import. With emitDecoratorMetadata those types are values, so the barrel is asked for them. One class is written as a type where no decorator stands, and one is asked for by nobody.
import { Engine, Wheel, OnlyAType } from "car-parts";
import * as parts from "car-parts";

declare global { namespace Reflect { function metadata(key: string, value: unknown): (target: any, member?: string | symbol) => void; } }
const recorded = new Map<string, any>();
Reflect.metadata = (key, value) => (target, member) => { recorded.set(key + " " + String(member ?? "class"), value); };
function noted(...anything: unknown[]): void {}

@noted
class Car {
  @noted radio!: parts.Radio;
  plain: OnlyAType | undefined;
  constructor(engine: Engine, wheel: Wheel) {}
}

const [engine, wheel] = recorded.get("design:paramtypes class");
console.log(new engine().start(), new wheel().turn(), new (recorded.get("design:type radio"))().play());

// FILE: node_modules/car-parts/engine.ts
export class Engine { start() { return "engine starts"; } }

// FILE: node_modules/car-parts/index.ts
export { Engine } from "./engine";
export { Wheel } from "./wheel";
export { Radio } from "./radio";
export { OnlyAType } from "./only-a-type";
export { NeverAsked } from "./never-asked";

// FILE: node_modules/car-parts/never-asked.ts
console.log("never-asked.ts is evaluated");
export class NeverAsked {}

// FILE: node_modules/car-parts/only-a-type.ts
console.log("only-a-type.ts is evaluated");
export class OnlyAType { never() { return "never"; } }

// FILE: node_modules/car-parts/package.json
{ "name": "car-parts", "version": "1.0.0", "type": "module", "main": "index.ts", "sideEffects": false }

// FILE: node_modules/car-parts/radio.ts
export class Radio { play() { return "radio plays"; } }

// FILE: node_modules/car-parts/wheel.ts
export class Wheel { turn() { return "wheel turns"; } }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleResolution": "bundler", "typeRoots": [ "../../../../../packages" ], "types": [ "bun-types" ], "noEmit": true, "experimentalDecorators": true, "emitDecoratorMetadata": true } }

// GENERATED: noted Car
// CHECK-LABEL: function {{*}}name="noted"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array site=[[w_1]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Car"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[L_4]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_2]], v2: undefined|null|[[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetConstructPrototype v0 layout=[[L_6]]
// CHECK-NEXT: v4 = NewObject v3 layout=[[L_6]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_7]]
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Jump -> next b4(v9)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: Jump -> next b4(v5)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
