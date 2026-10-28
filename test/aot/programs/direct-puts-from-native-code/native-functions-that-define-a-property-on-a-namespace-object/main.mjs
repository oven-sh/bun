// What Error.captureStackTrace() and the date getters of fs.Stats define on a namespace object is listed by Reflect.ownKeys() after the exports and is not readable.
import { Stats } from "node:fs";
import * as own from "./main.mjs";
import * as named from "./exports-the-names.mjs";
import * as other from "./exports-other-names.mjs";
import * as stars from "./exports-stars.mjs";
import * as commonjs from "./commonjs.cjs";
import * as json from "./data.json";
import * as path from "node:path";

export const first = 1;
export let stack = "an export";

const keyOf = k => [k][0];
const added = ["stack", "originalLine", "originalColumn", "atime", "mtime"];
function remove(o, k) {
  try {
    return delete o[keyOf(k)];
  } catch (e) {
    return e.constructor.name;
  }
}
function show(text, ns) {
  const mine = list =>
    list
      .filter(k => typeof k === "symbol" || added.includes(k) || ns !== path)
      .map(String)
      .join();
  console.log(text, "| own keys:", mine(Reflect.ownKeys(ns)));
  console.log(
    text,
    "| names:",
    mine(Object.getOwnPropertyNames(ns)),
    "| keys:",
    mine(Object.keys(ns)),
    "| symbols:",
    mine(Object.getOwnPropertySymbols(ns)),
  );
  console.log(
    text,
    "| copied:",
    mine(Object.keys({ ...ns })),
    "| descriptors:",
    mine(Reflect.ownKeys(Object.getOwnPropertyDescriptors(ns))),
  );
  const listed = [];
  for (const k in ns) listed.push(k);
  console.log(text, "| for in:", mine(listed), "|", Object.isFrozen(ns), Object.isSealed(ns), Object.isExtensible(ns));
  for (const k of added)
    console.log(
      text,
      "|",
      k,
      typeof ns[keyOf(k)],
      keyOf(k) in ns,
      Object.hasOwn(ns, keyOf(k)),
      typeof Object.getOwnPropertyDescriptor(ns, keyOf(k)),
    );
}

const dynamic = await import("./imported-by-a-call.mjs");
for (const [text, ns] of Object.entries({ own, named, other, stars, commonjs, json, path, dynamic })) {
  show(text + " before", ns);
  Error.captureStackTrace(ns);
  console.log(typeof Reflect.get(Stats.prototype, "atime", ns));
  Error.prepareStackTrace = () => "prepared";
  Error.captureStackTrace(ns);
  Error.prepareStackTrace = undefined;
  console.log(typeof Reflect.get(Stats.prototype, "mtime", ns));
  show(text + " after", ns);
  console.log(text, "| deleted:", added.map(k => remove(ns, k)).join());
  console.log(
    text,
    "| own keys:",
    Reflect.ownKeys(ns)
      .filter(k => typeof k === "symbol" || added.includes(k))
      .map(String)
      .join(),
  );
}
console.log(stack, named.stack, named.atime, stars.stack, commonjs.stack, json.stack, dynamic.stack);
