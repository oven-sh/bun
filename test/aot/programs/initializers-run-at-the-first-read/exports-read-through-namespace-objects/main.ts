// Exports read by computed keys, through dynamic imports, require and re-exported namespaces.
import { TABLE, LIST, Thing, SET, counter, bump } from "./named";
import * as star from "./star";
import * as through from "./through";
const log: string[] = [];
log.push(JSON.stringify([TABLE, LIST, new Thing().n, [...SET], counter]));
bump();
log.push(JSON.stringify(counter));
function pick(ns: Record<string, unknown>, key: string) { return ns[key]; }
for (const key of ["ONE", "TWO", "THREE", "MISSING"]) { const v = pick(star, key); log.push(key + " " + (v instanceof Map ? JSON.stringify([...v]) : JSON.stringify(v))); }
log.push(Object.keys(star).join() + " | " + Object.keys(through).join());
log.push(JSON.stringify({ ...star, THREE: undefined }));
log.push(String(through.ONE === star.ONE) + String(through.RENAMED === TABLE) + JSON.stringify(through.inner.FROM_ESM) + ("LATE" in through));
log.push(JSON.stringify(Object.getOwnPropertyDescriptor(star, "TWO")));
const required = require("./required");
log.push(JSON.stringify([required.FROM_ESM, required.OTHER, required.FROM_ESM === through.inner.FROM_ESM]));
const name = "./dyna" + (log.length > 0 ? "mic" : "");
Promise.all([import("./dynamic"), import(name)]).then(([first, second]) => {
  log.push(JSON.stringify([first.CONFIG, first.DERIVED, first.MAYBE, first.default, first === second, Object.keys(second)]));
  const { CONFIG, ...rest } = second as Record<string, unknown>;
  log.push(JSON.stringify([CONFIG === first.CONFIG, Object.keys(rest)]));
  console.log(log.join("\n"));
});
