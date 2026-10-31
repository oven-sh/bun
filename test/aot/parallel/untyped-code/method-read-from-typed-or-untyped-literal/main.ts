// A method is read from a value whose type names a literal with that method. The compiler expects that literal or a look-alike literal of an untyped CommonJS file, and leaves the closures of both unmade
// until they are read. The value really comes from a thenable of the CommonJS file. The build verifies the program after every stage.
// Flags: --aot-check=verify-each-stage
// Env of the executable: BUN_JSC_validateAOTRuntime=1
import { call, drain, poke } from "./untyped.cjs";
function show(x: number): string { return Object.is(x, -0) ? "-0" : String(x); }
function say(label: string, run: () => string): void {
  let text: string;
  try { text = run(); } catch (error) { text = "THROWS " + (error instanceof Error ? error.name : typeof error); }
  console.log(label, text, drain());
}
async function sayLater(label: string, run: () => Promise<string>): Promise<void> {
  let text: string;
  try { text = await run(); } catch (error) { text = "THROWS " + (error instanceof Error ? error.name : typeof error); }
  console.log(label, text, drain());
}
interface T2 { a2: number; m2(): number; c2?: boolean; nested2: { x2: number }; d2: number | null; }
function ours(): T2 { return { a2: 4294967296, m2(): number { return this.a2 * 2; }, c2: true, nested2: { x2: 2147483647 }, d2: -7 }; }
let kept: T2 | undefined;
await sayLater("enters", async (): Promise<string> => { const v: T2 = await (call() as unknown as PromiseLike<T2>); kept = v; return "in"; });
say("assign", (): string => { const v = kept; if (v === undefined) return "is undefined"; const target = ours(); Object.assign(target, v); return show(target.a2); });
say("after a change outside", (): string => { const v = kept; if (v === undefined) return "is undefined"; poke(); return [show(v.a2 * 2), typeof v.m2, (v.c2 ? "yes" : "no"), Object.keys(v.nested2).join(), String(v.d2 ?? "none")].join(" ") + Object.keys(v).join(); });
say("our own", (): string => { const v = ours(); return [show(v.a2 * 2), typeof v.m2, show(v.m2())].join(" "); });
