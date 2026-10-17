// A literal with a spread satisfies the type of the optional parameter of an async generator method and is passed to it.
declare const console: { log(...values: unknown[]): void };
import { C } from "./lib";
function f(a: string, b: number): Omit<NonNullable<Parameters<C["callService"]>[1]>, "x" | "y" | "z"> { return { timeout: b, headers: { a } } }
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
console.log(await new S().run(false));
console.log(await new S().run(true));
