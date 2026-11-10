import { order } from "./log";
import { name as next, fn as nextFn } from "./m1";
order.push("m0");
export const name = "m0";
export function fn() { return "fn0"; }
export const seesNext = () => [next, nextFn()];
