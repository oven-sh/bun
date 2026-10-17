// A literal with a spread under `satisfies`, outside and inside a `try` block.
declare const console: { log(...values: unknown[]): void };
import type { CallOptions } from "./sdk";
function f(a: string, b: number): Omit<CallOptions, "k1" | "k2"> { return { timeout: b, headers: { a } } }
type P = { timeout?: number; headers?: Record<string, string>; retries?: number; o0?: number; o1?: number; o2?: number; o3?: number; o4?: number; o5?: number; o6?: number; o7?: number; o8?: number; o9?: number; o10?: number; o11?: number; o12?: number; o13?: number; o14?: number; o15?: number; o16?: number; o17?: number; o18?: number; o19?: number; o20?: number; o21?: number; o22?: number; o23?: number; o24?: number; o25?: number; o26?: number; o27?: number; o28?: number; o29?: number; o30?: number; o31?: number; o32?: number; o33?: number; o34?: number; o35?: number; o36?: number; o37?: number; o38?: number; o39?: number; o40?: number; o41?: number; o42?: number; o43?: number; x: number; y: string; z: boolean };
function g(p: P): string { return p.x + " " + p.y + " " + p.z + " " + p.timeout + " " + Object.keys(p).join() }
const made: P = { x: 0, y: "", z: false }; g(made);
function words(e: unknown) { return "THROWN: " + (e as Error).message.split("\n").slice(0, 2).join(" | ").slice(0, 260) }
function outside(): string { const o = { ...f("a", 1), x: 1, y: "y", z: true } satisfies P; return g(o) }
function inside(): string { try { const o = { ...f("a", 1), x: 1, y: "y", z: true } satisfies P; return g(o) } catch (e) { return words(e) } }
function insideInferred(): string { try { const o = { ...f("a", 1), x: 1, y: "y", z: true }; return g(o) } catch (e) { return words(e) } }
function insideStraight(): string { try { return g({ ...f("a", 1), x: 1, y: "y", z: true }) } catch (e) { return words(e) } }
try { console.log("outside a try: " + outside()) } catch (e) { console.log("outside a try: " + words(e)) }
console.log("in a try: " + inside());
console.log("in a try, inferred: " + insideInferred());
console.log("in a try, straight: " + insideStraight());
