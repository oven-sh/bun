// A literal with a spread under `satisfies`, in a program that also casts parsed JSON to a type with members of the same names.
declare const console: { log(...values: unknown[]): void };
import { C } from "./lib";
function f(a: string, b: number): Omit<NonNullable<Parameters<C["callService"]>[1]>, "x" | "y" | "z"> { return { timeout: b, headers: { a } } }

interface Config { timeout?: number; retries?: number }
const config = JSON.parse('{"timeout":5}') as Config;
function words(e: unknown) { return "THROWN: " + (e as Error).message.split("\n").slice(0, 2).join(" | ").slice(0, 260) }
class S { c = new C(); tag?: () => string;
  get() { return this.c }
  run = async (flag: boolean): Promise<string> => {
    const out: string[] = [];
    try {
      const o = { ...f("a", 1), x: 1, y: "y", z: flag ? undefined : this.tag?.() } satisfies Parameters<C["callService"]>[1];
      for await (const line of this.get().callService("q", o)) out.push(line);
    } catch (e) { out.push(words(e)) }
    return out.join();
  }
}
console.log(config.timeout);
console.log(await new S().run(false));
console.log(await new S().run(true));
