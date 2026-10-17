// A literal with a spread satisfies an interface, and a union, that only a declaration file declares.
declare const console: { log(...values: unknown[]): void };
import type { C, P, U } from "./sdk";
function f(a: string, b: number): Omit<NonNullable<Parameters<C["callService"]>[1]>, "k1" | "k2"> { return { timeout: b, headers: { a } } }
type Q = { timeout?: number; headers?: Record<string, string>; retries?: number; o0?: number; o1?: number; o2?: number; o3?: number; o4?: number; o5?: number; o6?: number; o7?: number; o8?: number; o9?: number; o10?: number; o11?: number; o12?: number; o13?: number; o14?: number; o15?: number; o16?: number; o17?: number; x: number; y: string; z: boolean };
function g(p: Q): string { return p.x + " " + p.y + " " + p.z + " " + p.timeout + " " + JSON.stringify(p.headers) + " " + Object.keys(p).join() }
const made: Q = { x: 0, y: "", z: false };
function row(n: string, run: () => unknown) { try { console.log(n + ": " + String(run())) } catch (e) { console.log(n + ": THROWN: " + (e as Error).message.split("\n").slice(0, 2).join(" | ").slice(0, 220)) } }
row("made", () => g(made));
row("satisfies a declared-only interface", () => { const o = { ...f("a", 1), x: 1, y: "y", z: true } satisfies P; return g(o) });
row("satisfies a union of declared-only types", () => { const o = { ...f("a", 1), x: 1, y: "y", z: true } satisfies U; return g(o) });
row("without the spread", () => { const o = { timeout: 1, x: 1, y: "y", z: true } satisfies P; return g(o) });
row("satisfies, used twice", () => { const o = { ...f("a", 1), x: 1, y: "y", z: true } satisfies P; return g(o) + " | " + g(o) + " | " + o.x });
row("in parentheses", () => { const o = ({ ...f("a", 1), x: 1, y: "y", z: true }) satisfies P; return g(o) });
