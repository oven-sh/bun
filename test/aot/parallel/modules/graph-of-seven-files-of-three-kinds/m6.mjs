import "./show.cjs";
import * as m1_0 from "./m1.mjs";
export function first() {
  return "m6.first";
}
export const second = { of: "m6" };
export const count = 5;
export default { of: "m6", first: "default.first" };
say("m6 begins");
tell("m6 early m1 *", () => m1_0);
tell("m6 early m1 *.first", () => m1_0.first);
tell("m6 early m1 *.default", () => m1_0.default);
globalThis.atTheEnd.push(() => tell("m6 late m1 *", () => m1_0));
globalThis.atTheEnd.push(() => tell("m6 late m1 *.first", () => m1_0.first));
globalThis.atTheEnd.push(() => tell("m6 late m1 *.default", () => m1_0.default));
say("m6 ends");
