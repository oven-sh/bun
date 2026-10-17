// An explicit `this` passed with `call`, `apply` or `bind` arrives unchanged.
// @ts-ignore
import * as m from "./untyped.js";
declare const console: any;
const { sloppy, strict } = m as any;
const log: any[] = [];
for (const f of [sloppy, strict]) {
  for (const t of [undefined, null, 1, "s", true, {}]) { log.push(f.call(t), f.apply(t), f.apply(t, []), f.bind(t)()); }
  log.push(f.call(), f.apply(), f());
}
const arrow = () => typeof (globalThis as any);
log.push(arrow.call(1), arrow.apply(2, []));
console.log(log.join("\n"));
