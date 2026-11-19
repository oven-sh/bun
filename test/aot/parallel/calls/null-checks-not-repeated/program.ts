declare const console: any;
interface T { a: number; b: number; c: string; next: T | undefined }
interface U extends T { d: number }
const log: any[] = [];
// The two runtimes word the error differently; both name the property.
function propertyIn(message: string) { const found = /(?:reading|setting) '(\w+)'|evaluating '\w+\.(\w+)/.exec(message); return found ? found[1] || found[2] : "?"; }
function attemptKind(name: string, f: () => any) { try { log.push(name + ": " + f()); } catch (e: any) { log.push(name + " threw " + e.constructor.name); } }
function attempt(name: string, f: () => any) { try { log.push(name + ": " + f()); } catch (e: any) { log.push(name + " threw " + e.constructor.name + " at " + propertyIn(e.message)); } }
const some: T = { a: 1, b: 2, c: "three", next: undefined };
const more: U = { a: 10, b: 20, c: "thirty", next: some, d: 40 };
const nothing = undefined as any as T;
const nil = null as any as T;

// Only one branch has the access.
function oneArm(t: T, flag: boolean) { let x = 0; if (flag) x = t.a; return x + t.b; }
// Short circuit.
function shortCircuit(t: T, flag: boolean) { const x = flag && t.a; return String(x) + t.b; }
function conditional(t: T, flag: boolean) { const x = flag ? t.a : 0; return x + t.b; }
// A loop that may not run.
function inLoop(t: T, n: number) { let x = 0; for (let i = 0; i < n; i++) x += t.a; return x + t.b; }
// A handler: the first access throws, control goes on.
function handled(t: T) { let x = 0; try { x = t.a; } catch { x = -1; } return x + ":" + t.b; }
function handledTwice(t: T) { let x = 0; try { x = t.a; x += t.b; } catch { x = -1; } try { x += t.b; } catch { x -= 100; } return x; }
function inFinally(t: T) { let x = 0; try { x = t.a; } finally { log.push("finally " + x); } return x + t.b; }
// Optional chaining does not throw, and says nothing afterwards.
function optional(t: T | undefined | null) { const x = t?.a; return String(x) + t!.b; }
// A cast yields its operand: undefined and null pass `as string` and stay what they are, so the read of `s.length` that is caught says nothing about `u`, and the read of `u.a` throws.
// An object is no string: compiled, the cast itself throws a TypeError for it.
function castResult(u: any) { const s = u as string; let n = 0; try { n = s.length; } catch { } return u.a; }
// Another value in the same variable.
function reassigned(t: T, other: T) { let x = t.a; t = other; return x + t.b; }
function throughNext(t: T) { const x = t.a; const n = t.next as T; return x + n.b; }
// A switch.
function switched(t: T, k: number) { let x = 0; switch (k) { case 1: x = t.a; break; case 2: x = t.b; break; default: break; } return x + t.c; }
// A store first.
function storeInArm(t: T, flag: boolean) { if (flag) t.a = 5; return t.b; }
// Two parameters, one tested.
function two(t: T, u: T) { return t.a + u.b; }
// The positive shape, for the message of the FIRST access: which property is named.
function straight(t: T) { return t.b + t.a + t.c; }
function throughCast(t: T) { return t.a + (t as U).d + (t as U).b; }
function nested(t: T) { function inner() { return t.b; } const x = t.a; return x + inner(); }
// Each inlined callee has its own cast of the one argument. In one branch only, the fact is not for the other callee.
interface HasA { a: number } interface HasB { b: number }
function readsA(x: HasA) { return x.a; } function readsB(x: HasB) { return x.b; }
function siblings(t: T) { return readsA(t) + readsB(t); }
function siblingsInArm(t: T, flag: boolean) { let x = 0; if (flag) x = readsA(t); return x + readsB(t); }
// Everything that relies on the type of a value that has passed a check: truthiness, comparison with null or undefined, casts, stores, arguments, results.
// And the same where the variable is assigned again on the way, in a branch or around a loop: then it is a different value, which has passed no check.
const holder: { kept: T | undefined | null } = { kept: undefined };
function describe(t: T | undefined | null) { return t === undefined ? "U" : t === null ? "N" : "O" + t.b; }
function usesAfter(t: T) { const x = t.a; holder.kept = t; return [x, t ? "truthy" : "falsy", t == null, t === undefined, t === null, typeof t, (t as U).b, t!.b, describe(t), describe(holder.kept), String(t?.c)].join(); }
function reassignedInArm(t: T, other: T, flag: boolean) { const x = t.a; if (flag) t = other; holder.kept = t; return [x, t ? "truthy" : "falsy", t == null, t === undefined, typeof t, describe(t), describe(holder.kept), String(t?.c)].join(); }
function reassignedInLoop(t: T, n: number) { let x = 0; for (let i = 0; i < n; i++) { x += t.a; t = t.next as T; if (!t) x += 1000; if (t == null) break; } return x + ":" + describe(t); }
function testedInArm(t: T, flag: boolean) { let x = 0; if (flag) x = t.a; return [x, t ? "truthy" : "falsy", t == null, describe(t)].join(); }
function testedInHandler(t: T) { let x = 0; try { x = t.a; } catch { return "caught " + [t ? "truthy" : "falsy", t == null, describe(t)].join(); } return x + describe(t); }
function siblingsHandled(t: T) { let x = 0; try { x = readsA(t); } catch { x = -1; } return x + ":" + readsB(t); }

for (const [name, value] of [["object", some], ["undefined", nothing], ["null", nil]] as [string, T][]) {
    for (const flag of [true, false]) {
        attempt("oneArm " + name + " " + flag, () => oneArm(value, flag));
        attempt("shortCircuit " + name + " " + flag, () => shortCircuit(value, flag));
        attempt("conditional " + name + " " + flag, () => conditional(value, flag));
        attempt("storeInArm " + name + " " + flag, () => storeInArm(value === some ? { ...some } : value, flag));
    }
    for (const n of [0, 1, 3]) attempt("inLoop " + name + " " + n, () => inLoop(value, n));
    for (const k of [0, 1, 2]) attempt("switched " + name + " " + k, () => switched(value, k));
    attempt("handled " + name, () => handled(value));
    attempt("handledTwice " + name, () => handledTwice(value));
    attempt("inFinally " + name, () => inFinally(value));
    attemptKind("optional " + name, () => optional(value));
    attemptKind("castResult " + name, () => castResult(value));
    attempt("reassigned " + name, () => reassigned(some, value));
    attempt("reassigned the other way " + name, () => reassigned(value, some));
    attempt("two " + name, () => two(some, value));
    attempt("two the other way " + name, () => two(value, some));
    attempt("straight " + name, () => straight(value));
    attempt("throughCast " + name, () => throughCast(value === some ? more : value));
    attempt("nested " + name, () => nested(value));
    attempt("siblings " + name, () => siblings(value));
    for (const flag of [false, true]) attempt("siblingsInArm " + name + " " + flag, () => siblingsInArm(value, flag));
    attempt("siblingsHandled " + name, () => siblingsHandled(value));
    attempt("usesAfter " + name, () => usesAfter(value === some ? more : value));
    for (const flag of [false, true]) {
        attempt("reassignedInArm " + name + " " + flag, () => reassignedInArm(some, value, flag));
        attempt("reassignedInArm the other way " + name + " " + flag, () => reassignedInArm(value, some, flag));
        attempt("testedInArm " + name + " " + flag, () => testedInArm(value, flag));
    }
    for (const n of [0, 1, 2, 3]) attempt("reassignedInLoop " + name + " " + n, () => reassignedInLoop(value === some ? more : value, n));
    attempt("testedInHandler " + name, () => testedInHandler(value));
}
attempt("throughNext of one without", () => throughNext(some));
attempt("throughNext of one with", () => throughNext(more));
console.log(log.join("\n"));
export {};
