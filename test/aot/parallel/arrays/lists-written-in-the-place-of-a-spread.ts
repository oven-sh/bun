const lines: string[] = [];
const show = (name: string, value: unknown) => void lines.push(name + " | " + JSON.stringify(value) + (Array.isArray(value) ? " | " + value.length + " " + Object.keys(value).join() : ""));
let ticks = 0;
const tick = <T>(value: T): T => { ticks++; lines.push("tick " + ticks + " " + String(value)); return value; };

function numbers(i: number, a: boolean, b: boolean): number[] { return [i, ...(a ? [i + 1] : []), 7, ...(b ? [i + 2, i + 3] : []), 9]; }
for (const a of [true, false]) for (const b of [true, false]) show("numbers " + a + " " + b, numbers(1, a, b));
function texts(name: string, verbose: boolean, file: string | undefined): string[] { return ["run", ...(verbose ? ["--verbose"] : []), name, ...(file ? ["--file", file] : [])]; }
show("texts", [texts("n", true, "f"), texts("n", false, undefined), texts("n", true, ""), texts("n", false, "g")]);
function mixed(which: number): unknown[] { return [...(which === 0 ? [] : which === 1 ? [1] : which === 2 ? ["two", 2] : [{ many: which }, [which], null, undefined]), "end"]; }
show("mixed", [mixed(0), mixed(1), mixed(2), mixed(3)]);
function plain(i: number) { return [0, ...[i, i + 1], ...[], ...[[i]], 9]; }
show("plain", plain(5));
function nested(a: boolean, b: boolean) { return [1, ...(a ? [2, ...(b ? [3] : [30, 31]), 4] : []), 5]; }
show("nested", [nested(true, true), nested(true, false), nested(false, true)]);
function otherArm(flag: boolean, other: Iterable<number>) { return [1, ...(flag ? [2] : other), 3]; }
show("another arm", [otherArm(true, [9]), otherArm(false, [9, 8]), otherArm(false, new Set([7, 7, 6])), otherArm(false, (function* () { yield 5; yield 4; })())]);
show("holes stay what a spread makes of them", [0, ...[, 1, , 2], 3]);
show("holes under a condition", ((on: boolean) => [0, ...(on ? [, 1] : [2, ,]), 3])(true));
show("order of computing", [tick("a"), ...(tick(true) ? [tick("b"), tick("c")] : [tick("never")]), ...(tick(0) ? [tick("never")] : []), tick("d")]);
function throws(on: boolean) { try { return [1, ...(on ? [(() => { throw new Error("in the list"); })()] : []), 3]; } catch (error) { return (error as Error).message; } }
show("a value that throws", [throws(true), throws(false)]);
const sum = (...values: number[]) => values.reduce((total, value) => total + value, values.length * 100);
function call(a: boolean, b: boolean, i: number) { return sum(i, ...(a ? [i + 1] : []), ...(b ? [i + 2, i + 3] : [])); }
show("arguments", [call(true, true, 1), call(true, false, 1), call(false, true, 1), call(false, false, 1)]);
class Point { x: number; y: number; z: number; constructor(x = -1, y = -2, z = -3) { this.x = x; this.y = y; this.z = z; } }
show("arguments of new", [new Point(...(ticks > 0 ? [1, 2] : [])), new Point(0, ...(ticks < 0 ? [1] : []))]);
show("Math.max", [Math.max(1, ...(ticks > 0 ? [5, 3] : [])), Math.max(...(ticks < 0 ? [5] : []))]);
function lengths(n: number): string { let total = 0, last = 0; for (let i = 0; i < n; i++) { const made = numbers(i, (i & 1) === 0, (i & 2) === 0); total += made.length; last = made[made.length - 1]! + made[1]!; made.push(i); total += made.length; } return total + " " + last; }
show("lengths", lengths(1000));
function local(n: number): number { let total = 0; for (let i = 0; i < n; i++) { const [first, second = -1, ...others] = [i, ...(i % 3 ? [i * 2] : []), ...(i % 5 ? [] : [1, 2, 3])]; total += first + second + others.length; for (const value of [...(i % 2 ? [i] : []), 1]) total += value; } return total; }
show("lists that never leave", local(1000));
const doubles = (on: boolean, x: number) => [0.5, ...(on ? [x, x / 3] : []), 1];
show("doubles", [doubles(true, 1), doubles(false, 1), doubles(true, 2 ** 40)]);
async function awaits(on: boolean) { return [1, ...(on ? [await Promise.resolve(2), 3] : []), ...((await Promise.resolve(on)) ? [4] : [5])]; }
function* yields(on: boolean): Generator<number, number[], number> { return [0, ...(on ? [yield 1, yield 2] : []), 9]; }
const stepped = yields(true); stepped.next(); stepped.next(10);
show("a generator", stepped.next(20).value);
const frozen = Object.freeze([1, ...(ticks > 0 ? [2] : [])]);
show("frozen", [frozen, Object.isFrozen(frozen)]);
Promise.all([awaits(true), awaits(false)]).then(values => { show("awaits", values); console.log(lines.join("\n")); });
