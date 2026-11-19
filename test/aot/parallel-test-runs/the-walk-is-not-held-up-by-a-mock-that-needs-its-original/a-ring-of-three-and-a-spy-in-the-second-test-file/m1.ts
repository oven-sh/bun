import { order } from "./log";
import { name as next, fn as nextFn } from "./m2";
order.push("m1");
export const name = "m1";
export function fn() { return "fn1"; }
export const seesNext = () => [next, nextFn()];
