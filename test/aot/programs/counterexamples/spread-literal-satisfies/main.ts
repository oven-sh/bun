// `{ ...f(), x, y, z } satisfies P`, P with many optional members, is passed on as a P.
declare const console: { log(...values: unknown[]): void };
import type { C } from "./sdk";
type Opts = Omit<NonNullable<Parameters<C["callService"]>[1]>, "k1" | "k2">;
function f(a: string, b: number): Opts { return { timeout: b, headers: { a } } }
function f2(a: string, b: number): Opts { const o: Opts = {}; o.timeout = b; if (a) o.headers = { a }; return o }
type P = { timeout?: number; headers?: Record<string, string>; retries?: number; signal?: { aborted: boolean }; o0?: number; o1?: number; o2?: number; o3?: number; o4?: number; o5?: number; o6?: number; o7?: number; o8?: number; o9?: number; o10?: number; o11?: number; o12?: number; o13?: number; o14?: number; o15?: number; o16?: number; o17?: number; x: number; y: string; z: boolean };
function g(p: P): string { return p.x + " " + p.y + " " + p.z + " " + p.timeout + " " + JSON.stringify(p.headers) + " " + Object.keys(p).join() }
function row(n: string, run: () => unknown) { try { console.log(n + ": " + String(run())) } catch (e) { console.log(n + ": THROWN: " + (e as Error).message.split("\n").slice(0, 2).join(" | ").slice(0, 200)) } }
row("satisfies, a const, then an argument", () => { const o = { ...f("a", 1), x: 1, y: "y", z: true } satisfies P; return g(o) });
row("the same, the source filled by stores", () => { const o = { ...f2("a", 1), x: 1, y: "y", z: true } satisfies P; return g(o) });
row("an inferred const", () => { const o = { ...f("a", 1), x: 1, y: "y", z: true }; return g(o) });
row("straight to the argument", () => g({ ...f("a", 1), x: 1, y: "y", z: true }));
row("annotated", () => { const o: P = { ...f("a", 1), x: 1, y: "y", z: true }; return g(o) });
row("used twice", () => { const o = { ...f("a", 1), x: 1, y: "y", z: true } satisfies P; return g(o) + " | " + g(o) + " | " + o.x });
