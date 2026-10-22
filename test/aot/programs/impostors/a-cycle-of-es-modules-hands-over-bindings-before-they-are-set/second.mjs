import { uses } from "./first.mjs";

uses("before the variables are set,");
export var n = 7;
export var a = [5, 6];
export var s = "abc";
export var f = x => x + 1;
export var o = { x: 1, y: 2 };
export let laterLet = 7;
export function hoisted(x) {
  return [x, typeof n, typeof a];
}
export function useAll(when) {
  uses(when);
}
uses("at the end of the second module,");
