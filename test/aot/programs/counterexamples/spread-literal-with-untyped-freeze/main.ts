// A literal with a spread under `satisfies`, in a program that freezes objects and sets prototypes through `any`.
declare const console: { log(...values: unknown[]): void };
import { C } from "./lib";
function f(a: string, b: number): Omit<NonNullable<Parameters<C["callService"]>[1]>, "x" | "y" | "z"> { return { timeout: b, headers: { a }, o0: 0, o1: 1, o2: 2, o3: 3, o4: 4, o5: 5, o6: 6, o7: 7, o8: 8, o9: 9, o10: 10, o11: 11, o12: 12, o13: 13, o14: 14, o15: 15, o16: 16, o17: 17, o18: 18, o19: 19, o20: 20, o21: 21, o22: 22, o23: 23 } }

interface Config { timeout?: number; retries?: number }
const config = JSON.parse('{"timeout":5}') as Config;
function fr(v: any) { return Object.freeze(v) }
function sp(v: any) { return Object.setPrototypeOf(v, null) }
fr({ q: 1 }); sp({ q: 2 });
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
