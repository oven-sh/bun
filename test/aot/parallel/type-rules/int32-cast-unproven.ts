// `value as int32` promises an `int32`, as an annotation does, and converts nothing: the build stops at a cast of a value that it cannot prove to be one. A cast proves nothing either: what it is stored into is reported too. `| 0` converts, in plain Bun as well, and is what the messages ask for. typed-objects/int32-proven-stores has the casts that the build accepts.
import type { int32 } from "bun";

type Lane = int32;
interface Update { lane: Lane }
const loose: any = JSON.parse('[7.9, "12"]');
const numbers: number[] = JSON.parse("[7.9, 5]");
function cast(n: number): number { return n as int32; }
function sum(a: int32, b: int32): number { return (a + b) as int32; }
function update(lane: unknown): Update { return { lane: lane as Lane }; }
function truthy(level: number): string { return (level as int32) ? "yes" : "no"; }
const list: unknown[] = [loose[0] as int32, 1.5 as int32, (numbers[0] as int32) as number];
let count: number = numbers[1];
(count as int32) += 1;
console.log(cast(numbers[0]), sum(1, 2), update(loose[1]).lane, truthy(0.5), list.join(" "), count);
/* Build errors:
error: TS100031: This expression is declared 'int32', but 'n' might not be an int32: it is a 'number', which can have a fraction, be out of range, or be NaN or -0. Write 'n | 0'.
error: TS100031: This expression is declared 'int32', but 'a + b' might not be an int32: it can be anything from -4294967296 to 4294967294. Write '(a + b) | 0'.
error: TS100031: Property 'lane' of 'Update' is declared 'int32', but 'lane as Lane' might not be an int32: it is a 'number', which can have a fraction, be out of range, or be NaN or -0. Write '(lane as Lane) | 0'.
error: TS100031: This expression is declared 'int32', but 'lane' might not be an int32: it is a 'number', which can have a fraction, be out of range, or be NaN or -0. Write 'lane | 0'.
error: TS100031: This expression is declared 'int32', but 'level' might not be an int32: it is a 'number', which can have a fraction, be out of range, or be NaN or -0. Write 'level | 0'.
error: TS100031: This expression is declared 'int32', but 'loose[0]' might not be an int32: its type is 'any'. Write 'loose[0] | 0'.
error: TS100032: This expression is declared 'int32', but '1.5' is not an int32: it has a fraction.
error: TS100031: This expression is declared 'int32', but 'numbers[0]' might not be an int32: it is a 'number', which can have a fraction, be out of range, or be NaN or -0. Write 'numbers[0] | 0'.
error: TS100031: This expression is declared 'int32', but 'count' might not be an int32: it is a 'number', which can have a fraction, be out of range, or be NaN or -0. Write 'count | 0'.
*/
