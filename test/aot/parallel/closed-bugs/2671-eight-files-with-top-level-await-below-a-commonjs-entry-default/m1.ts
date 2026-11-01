// @ts-nocheck
import "./show.cjs";
import "./m2.cjs";
import { first as m3_1 } from "./m3.mjs";
import m4_2, { second as m4_2_named } from "./m4.js";
export const first = "m1.first";
say("m1 begins");
await { then(done) { done(3); } };
tell("m1 early m3 first", () => m3_1);
tell("m1 early m4 default", () => m4_2);
tell("m1 early m4 second", () => m4_2_named);
try {
  await Promise.reject(new Error("no"));
} catch (error) {
  say("m1 caught", error.message);
}
export class second {
  static of = "m1";
}
export const count = 5;
export default class {
  static first = "m1";
}
globalThis.atTheEnd.push(() => tell("m1 late m3 first", () => m3_1));
globalThis.atTheEnd.push(() => tell("m1 late m4 default", () => m4_2));
globalThis.atTheEnd.push(() => tell("m1 late m4 second", () => m4_2_named));
say("m1 ends");
