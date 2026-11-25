import { order } from "./log";
import { name as next, fn as nextFn } from "./m0";
order.push("m2");
export const name = "m2";
export function fn() { return "fn2"; }
export const seesNext = () => [next, nextFn()];
