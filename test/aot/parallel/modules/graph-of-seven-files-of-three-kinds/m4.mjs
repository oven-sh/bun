import "./show.cjs";
import { second as m6_0 } from "./m6.mjs";
import m6_1 from "./m6.mjs";
export function first() {
  return "m4.first";
}
export let second = 2;
export const count = 1;
say("m4 begins");
tell("m4 early m6 second", () => m6_0);
tell("m4 early m6 default", () => m6_1);
tell("m4 early m6 default.first", () => m6_1.first);
export default function () {
  return "m4";
}
globalThis.atTheEnd.push(() => tell("m4 late m6 second", () => m6_0));
globalThis.atTheEnd.push(() => tell("m4 late m6 default", () => m6_1));
globalThis.atTheEnd.push(() => tell("m4 late m6 default.first", () => m6_1.first));
say("m4 ends");
