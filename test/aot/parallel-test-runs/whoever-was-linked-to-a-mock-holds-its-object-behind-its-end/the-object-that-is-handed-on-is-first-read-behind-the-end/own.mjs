import * as dep from "./dep.cjs";
import { d } from "./mid.mjs";
const show = it => it.value() + ":" + String(it.added) + ":" + Object.keys(it).sort().join("+");
export const seen = () => show(d);
export const same = () => String(d === dep);
