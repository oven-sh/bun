// A member that is declared `int32` is one by proof only if every object that is taken as that type was made with an int32 there. An object literal, a getter and an instance that hold a `number` are assignable to the type, so a read of the member is no int32 any more. structural-types/int32-members-are-stored-to-through-a-type-that-says-number has the stores that the build does not follow.
// Todo: The build accepts the four reads that the stored text refuses with TS100031, and the executable prints what plain Bun prints (1.5 four times): an int32 that is declared and not proven is no error here today.
import type { int32 } from "bun";

const given: number[] = JSON.parse("[1.5]");
const n: number = given[0];
interface FromALiteral { x: int32 }
interface FromAGetter { x: int32 }
interface FromAnInstance { x: int32 }
interface Optional { y?: int32 }
function ofLiteral(point: FromALiteral): int32 { return point.x; }
function ofGetter(point: FromAGetter): int32 { return point.x; }
function ofInstance(point: FromAnInstance): int32 { return point.x; }
function ofOptional(holder: Optional): int32 { return holder.y ?? -1; }
class Pixel { x: number = n; }
const literal = { x: n };
const getter = { get x(): number { return n; } };
const optional = { y: n };

console.log(ofLiteral(literal), ofGetter(getter), ofInstance(new Pixel()), ofOptional(optional));
/* Build errors:
error: TS100031: The return value of 'ofLiteral' is declared 'int32', but 'point.x' might not be an int32: it is a 'number', which can have a fraction, be out of range, or be NaN or -0. Write 'point.x | 0'.
error: TS100031: The return value of 'ofGetter' is declared 'int32', but 'point.x' might not be an int32: it is a 'number', which can have a fraction, be out of range, or be NaN or -0. Write 'point.x | 0'.
error: TS100031: The return value of 'ofInstance' is declared 'int32', but 'point.x' might not be an int32: it is a 'number', which can have a fraction, be out of range, or be NaN or -0. Write 'point.x | 0'.
error: TS100031: The return value of 'ofOptional' is declared 'int32', but 'holder.y ?? -1' might not be an int32: it is a 'number', which can have a fraction, be out of range, or be NaN or -0. Write '(holder.y ?? -1) | 0'.
*/
