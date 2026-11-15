// RUN(ONE): link
// OPTIONS(ONE): threads=1
// RUN(T2A): link
// OPTIONS(T2A): threads=2
// SAME: ONE T2A
// RUN(T8A): link
// OPTIONS(T8A): threads=8
// SAME: ONE T8A
// RUN(T32A): link
// OPTIONS(T32A): threads=32
// SAME: ONE T32A
// RUN(T32B): link
// OPTIONS(T32B): threads=32
// SAME: ONE T32B
// ONE: layout {{*}}key="start" {{*}}key="stop" declared={type=boolean} flags=[IsRequired]}]

// `key` has the type of a member of `holder`, and the type of `holder` comes from a member of `Shop.Gadget`, which has a member under `key`.
// Whoever comes by `holder` finds `key` in its own annotation, so that it names no member. Whoever comes by the members finds a symbol.
// The files are checked in the order of the program, which comes by `holder` first: TypeScript finds fault with both lines, and `key` names no member on any number of threads.

// FILE: main.ts
import { holder } from "./holder";
import { use } from "./user";
import { make } from "./maker";
declare const console: { log(...values: unknown[]): void };
console.log(use(make()), typeof holder.first);

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"target":"esnext","module":"esnext","moduleResolution":"bundler","noEmit":true,"types":[]}}

// FILE: holder.ts
import "./gadget";
const base: unique symbol = Symbol("base"); // @ts-expect-error
export const holder = { key: base, first: undefined as unknown as Shop.Gadget["start"] | undefined } as const;

// FILE: gadget.ts
import type { holder } from "./holder"; // @ts-expect-error
declare const key: typeof holder.key;
declare global {
  namespace Shop {
    interface Gadget {
      start(): number;
      [key]?: string;
      stop: boolean;
    }
  }
}
export {};

// FILE: user.ts
export function use(gadget: Shop.Gadget) {
  return gadget.stop ? 0 : gadget.start();
}

// FILE: maker.ts
export function make(): Shop.Gadget {
  return { start() { return 2; }, stop: false };
}
