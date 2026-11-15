import * as lib from "./lib.cjs";
import { asked, seen } from "./other.mjs";
const again = await import("./lib.cjs");
console.log(
  lib === seen,
  lib === again,
  lib.who() === lib,
  asked() === lib,
  typeof lib.default,
  Object.keys(lib).join(),
);
let hits = 0;
for (let i = 0; i < 1000; i++) if (lib.who() === lib && asked() === seen) hits++;
console.log(hits, lib.count(), lib.count(), lib.default.count(), lib.rate);
lib.default.later = () => "later";
lib.default.rate = 4;
console.log(
  typeof lib.later,
  lib.rate,
  lib.default.rate,
  lib.default.who() === lib.default,
  Object.isExtensible(lib),
  String(lib[Symbol.toStringTag]),
);
const borrowed = lib.who;
console.log(borrowed.call(5) == 5, (0, lib.who)() === undefined || (0, lib.who)() === globalThis);
