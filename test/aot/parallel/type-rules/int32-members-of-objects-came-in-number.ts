// The build proves what is stored through a type that says `int32`. A literal without a written type that is handed over whole is held to the type whose names it has: it is refused where it holds a `number`. An object with a getter and an instance of a class that says `number` are assignable to the type as well, and the build does not stop at them: the read tests (an-object-of-another-type-is-taken-for-one-with-int32-members.ts runs them). structural-types/int32-members-are-stored-to-through-a-type-that-says-number has the stores that the build does not follow.
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
error: TS100031: Property 'x' is declared 'int32', but 'n' might not be an int32: it is a 'number', which can have a fraction, be out of range, or be NaN or -0. Write 'n | 0'.
error: TS100031: Property 'y' is declared 'int32', but 'n' might not be an int32: it is a 'number', which can have a fraction, be out of range, or be NaN or -0. Write 'n | 0'.
*/
