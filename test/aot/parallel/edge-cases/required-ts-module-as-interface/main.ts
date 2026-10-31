// What `require()` of a TypeScript module returns is used where an interface is expected.
declare const console: { log(...values: unknown[]): void };
import { mod } from "./mod.ts";
interface Api { match(x: number): number; other(): string }
const own: Api = Object.freeze({ match: (x: number) => x * 2, other: () => "own" });
async function run<T, R>(first: T, n: number, ctx: { api: Api | null; make: (t: T) => R; f1: number; f2: number; f3: T[]; f4: number; f5: number; f6: number; f7: number }): Promise<string> {
  return String(ctx.make(first)) + " " + ctx.api?.match(n) + " " + ctx.api?.other() + " " + ctx.f7;
}
function direct(api: Api | null): string { return api?.match(1) + " " + api?.other() }
try { console.log(await run("a", 1, { api: own, make: t => t + "!", f1: 1, f2: 2, f3: [], f4: 4, f5: 5, f6: 6, f7: 7 })); } catch (e) { console.log("THROWN: " + (e as Error).message); }
try { console.log(await run("b", 1, { api: mod, make: t => t.length, f1: 1, f2: 2, f3: ["x"], f4: 4, f5: 5, f6: 6, f7: 7 })); } catch (e) { console.log("THROWN: " + (e as Error).message); }
try { console.log(direct(mod)); } catch (e) { console.log("THROWN: " + (e as Error).message); }
try { const held: { api: Api | null } = { api: mod }; console.log(held.api?.match(5)); } catch (e) { console.log("THROWN: " + (e as Error).message); }
