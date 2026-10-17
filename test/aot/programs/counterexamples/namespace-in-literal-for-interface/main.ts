// The namespace object of a JavaScript module stands in a literal where an interface is expected.
declare const console: { log(...values: unknown[]): void };
import { mod } from "./mod.ts";
interface Api { match(x: number): number; other(): string }
const own: Api = { match: x => x * 2, other: () => "own" };
const given = JSON.parse('{"api":null,"f1":1,"f2":2,"f3":3,"f4":4,"f5":5,"f6":6,"f7":7}') as { api: null; f1: number; f2: number; f3: number; f4: number; f5: number; f6: number; f7: number };
async function run<T>(first: T, n: number, ctx: { api: Api | null; f1: number; f2: number; f3: number; f4: number; f5: number; f6: number; f7: number }): Promise<string> {
  return String(first) + " " + ctx.api?.match(n) + " " + ctx.api?.other() + " " + ctx.f7;
}
try { console.log(await run("a", 1, { api: own, f1: 1, f2: 2, f3: 3, f4: 4, f5: 5, f6: 6, f7: 7 })); } catch (e) { console.log("THROWN: " + (e as Error).message); }
try { console.log(await run("b", 1, { api: mod, f1: 1, f2: 2, f3: 3, f4: 4, f5: 5, f6: 6, f7: given.f7 })); } catch (e) { console.log("THROWN: " + (e as Error).message); }
try { console.log(await run("c", 1, given)); } catch (e) { console.log("THROWN: " + (e as Error).message); }
