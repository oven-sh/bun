// A typed read of an array element that is an accessor runs the getter, as in plain Bun, also where the element type allows undefined.
declare const console: { log(...values: unknown[]): void };
function optional(a: (number | undefined)[], i: number): number | undefined { return a[i]; }
function optionalReadonly(a: readonly (number | undefined)[], i: number): number | undefined { return a[i]; }
function optionalTuple(a: [number, number | undefined, number]): number | undefined { return a[1]; }
function optionalTupleMember(a: [number, number?, number?]): number | undefined { return a[1]; }
function optionalDestructure(a: (number | undefined)[]): number | undefined { const [, second] = a; return second; }
function destructureWithDefault(a: number[]): number { const [, second = -1] = a; return second; }
function unknownElement(a: unknown[], i: number): unknown { return a[i]; }
function anyElement(a: any[], i: number): any { return a[i]; }
function nullish(a: readonly number[], i: number): number { return a[i] ?? -1; }
function stringOrUndefined(a: readonly (string | undefined)[], i: number): string | undefined { return a[i]; }
const calls: string[] = [];
function tell(name: string, f: () => unknown): void { calls.length = 0; let text: string; try { text = String(f()); } catch (e) { text = e instanceof Error ? e.name + ": " + e.message.split("\n")[0].slice(0, 52) : String(e); } console.log(name + ": " + text + " [" + calls.join() + "]"); }
const own = (): any => Object.defineProperty([1.5, 2.5, 3.5], "1", { get() { calls.push("get"); return 9; }, configurable: true });
const strings = (): any => Object.defineProperty(["a", "b", "c"], "1", { get() { calls.push("get"); return "g"; }, configurable: true });
tell("(number | undefined)[]", () => optional(own(), 1));
tell("readonly (number | undefined)[]", () => optionalReadonly(own(), 1));
tell("[number, number | undefined, number]", () => optionalTuple(own()));
tell("[number, number?, number?]", () => optionalTupleMember(own()));
tell("destructuring (number | undefined)[]", () => optionalDestructure(own()));
tell("destructuring with a default", () => destructureWithDefault(own()));
tell("unknown[]", () => unknownElement(own(), 1));
tell("any[]", () => anyElement(own(), 1));
tell("readonly number[] ?? -1", () => nullish(own(), 1));
tell("readonly (string | undefined)[]", () => stringOrUndefined(strings(), 1));
