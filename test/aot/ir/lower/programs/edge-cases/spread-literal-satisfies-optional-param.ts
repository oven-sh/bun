// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2
// CHECK-LABEL: function {{*}}name="f"
// CHECK-LABEL: function {{*}}name="words"
// CHECK-LABEL: function {{*}}name="S"
// CHECK-LABEL: function {{*}}name="get"

// FILE: main.ts
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

// FILE: lib.ts
export class C { async *callService(a: string, opts?: { k1?: string; k2?: number; timeout?: number; headers?: Record<string, string>; retries?: number; o0?: number; o1?: number; o2?: number; o3?: number; o4?: number; o5?: number; o6?: number; o7?: number; o8?: number; o9?: number; o10?: number; o11?: number; o12?: number; o13?: number; o14?: number; o15?: number; o16?: number; o17?: number; o18?: number; o19?: number; o20?: number; o21?: number; o22?: number; o23?: number; o24?: number; o25?: number; o26?: number; o27?: number; o28?: number; o29?: number; o30?: number; o31?: number; o32?: number; o33?: number; o34?: number; o35?: number; o36?: number; o37?: number; o38?: number; o39?: number; u0?: unknown; a0?: any; u1?: unknown; a1?: any; u2?: unknown; a2?: any; x: number; y: string; z?: string }): AsyncGenerator<string> { yield a + " " + (opts ? opts.x + " " + opts.y + " " + opts.z + " " + opts.timeout + " " + Object.keys(opts).join() : "none") } }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
