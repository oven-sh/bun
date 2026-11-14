// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 7
// CHECK-LABEL: function {{*}}name="noted"
// CHECK-LABEL: function {{*}}name="Car"

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
