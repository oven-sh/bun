// RUN(ONE): link
// OPTIONS(ONE): threads=1
// RUN(T2A): link
// OPTIONS(T2A): threads=2
// SAME: ONE T2A
// RUN(T8A): link
// OPTIONS(T8A): threads=8
// SAME: ONE T8A
// RUN(T8B): link
// OPTIONS(T8B): threads=8
// SAME: ONE T8B
// RUN(T16A): link
// OPTIONS(T16A): threads=16
// SAME: ONE T16A
// ONE-COUNT-2: variable {{*}}name="kFirst" {{*}}declared={type=undefined|null|symbol|absent

// The keys of `Shop.Gadget` have the types of members of what keys.ts exports, and the type that keys.ts writes behind `as` names a member of `Shop.Gadget`: a ring, but only for whoever goes through the written type.
// To know the type of the `as` nobody has to. A check of the file goes through it, and a build makes no such check. early.ts stands first in the order of the program and comes to the ring from the members of `Shop.Gadget`;
// with more than one thread keys.ts is mostly visited ahead of it. The program does not depend on which of the two comes first.

// FILE: main.ts
import { use } from "./early";
import { left } from "./left";
import { make } from "./gadget";
import keys from "./keys";
declare const console: { log(...values: unknown[]): void };
console.log(use(make()), left(), typeof keys.startOfGadget);

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"target":"esnext","module":"esnext","moduleResolution":"bundler","noEmit":true,"types":[]}}

// FILE: early.ts
export function use(gadget: Shop.Gadget) {
  return gadget.start();
}

// FILE: keys.ts
export default {
  kFirst: Symbol("first"),
  kSecond: Symbol("second"),
  startOfGadget: undefined,
} as unknown as {
  readonly kFirst: unique symbol;
  readonly kSecond: unique symbol;
  startOfGadget: Shop.Gadget["start"] | undefined;
};

// FILE: gadget.ts
import keys from "./keys";
const kFirst: typeof keys.kFirst = keys.kFirst;
const kSecond: typeof keys.kSecond = keys.kSecond;
declare global {
  namespace Shop {
    interface Base {
      start(): number;
    }
    interface Gadget extends Base {
      [kFirst]?: number;
      [kSecond]?: string;
    }
  }
}
export function make(): Shop.Gadget {
  return { [kFirst]: 1, [kSecond]: "two", start() { return 2; } };
}
keys.startOfGadget = make().start;

// FILE: left.ts
import keys from "./keys";
import { make } from "./gadget";
const kFirst: typeof keys.kFirst = keys.kFirst;
export function left() {
  return [typeof kFirst, make()[kFirst]].join();
}
