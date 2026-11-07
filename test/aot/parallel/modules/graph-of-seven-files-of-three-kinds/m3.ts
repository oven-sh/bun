// @ts-nocheck
import "./show.cjs";
export * from "./m4.mjs";
say("m3 begins");
export function first() {
  return "m3.first";
}
export class second {
  static of = "m3";
}
export let count = 0;
export const more = () => ++count;
export default class {
  static first = "m3";
}
say("m3 ends");
