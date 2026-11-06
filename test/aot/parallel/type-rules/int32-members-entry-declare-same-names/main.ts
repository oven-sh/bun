// Each entry point declares a Point of its own: an interface, an alias, a class, an enum's members, a namespace, a global. Only this one says int32, and it reads what its own types say.
// Entry points: ./interface.ts ./alias.ts ./class.ts ./enum.ts ./namespace.ts ./global.ts ./script.ts ./untyped.js
import type { int32 } from "bun";
interface Point { x: int32; y: int32 }
type Alias = { x: int32; y: int32 };
class Pixel { x: int32 = 5; y: int32 = 6; }
namespace Shapes {
  export interface Point { x: int32; y: int32 }
  export function make(x: int32, y: int32): Point { return { x, y }; }
}
function make(x: int32, y: int32): Point { return { x, y }; }
function makeAlias(x: int32, y: int32): Alias { return { x, y }; }
function named(point: Point): int32 { return point.x; }
function ofInterface(): int32 { return make(3, 4).y; }
function ofAlias(): int32 { return makeAlias(7, 8).x; }
function ofClass(): int32 { return new Pixel().y; }
function ofNamespace(): int32 { return Shapes.make(9, 10).y; }
function parsed(text: string): int32 { return (JSON.parse(text) as Point).x; }
console.log(named(make(1, 2)), ofInterface(), ofAlias(), ofClass(), ofNamespace(), parsed('{"x":11,"y":12}'));
