// super() of a class that extends a global class (Error, Map) calls the host constructor: it has no inline paths for parents that are compiled functions. Neither has the fallback behind the guard "the class object is unmodified".
// SIZE< NamedError 200
// SIZE< Keyed 200
// SIZE< CodeError 500
// CALLS- NamedError ConstructClosure
// CALLS- Keyed ConstructClosure
// CALLS- CodeError ConstructClosure
class NamedError extends Error { constructor(message: string) { super(message); this.name = "NamedError"; } }
class PlainError extends Error { }
class CodeError extends NamedError { code: number; constructor(message: string, code: number) { super(message); this.code = code; } }
class Base { v: number; constructor(v: number) { this.v = v; } }
class Derived extends Base { w: number; constructor(v: number, w: number) { super(v); this.w = w; } }
class Forwarding extends Base { }
class Keyed extends Map<string, number> { constructor() { super(); } }
export function makeAll(): unknown[] {
  return [new NamedError("a"), new PlainError("b"), new CodeError("c", 3), new Derived(1, 2), new Forwarding(4), new Keyed()];
}
const describe = (x: unknown) => (x as object).constructor.name + ":" + (x instanceof Error ? x.name + ":" + x.message : "") + ":" + Object.keys(x as object).join();
const made = makeAll();
console.log(made.map(describe).join(" "));
console.log((made[2] as CodeError).code, (made[3] as Derived).v, (made[3] as Derived).w, (made[4] as Forwarding).v, (made[5] as Keyed).size);
class Late extends NamedError { constructor() { super("late"); } }
console.log(describe(new Late()), new Late() instanceof NamedError, new Keyed().set("k", 1).get("k"));
try { (NamedError as any)("no new"); } catch (e) { console.log((e as Error).constructor.name); }
