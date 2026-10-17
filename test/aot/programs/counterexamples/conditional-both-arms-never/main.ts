// `return yes ? exitWith(0) : fail()` where both functions return `never`.
declare const console: { log(...values: unknown[]): void };
import { exitWith, fail } from "./exits.ts";
async function answered(m: string): Promise<boolean> { return m.length > 0 }
async function leave(kind: "a" | "b", message: string, reason: string): Promise<never> {
  await Promise.resolve(kind)
  const yes = await answered(message)
  await Promise.resolve({ message, reason })
  return yes ? exitWith(0) : fail()
}
console.log("before");
try { await leave("a", "m", "r") } catch (e) { console.log("caught " + (e as Error).message) }
try { await leave("a", "", "r") } catch (e) { console.log("caught " + (e as Error).message) }
