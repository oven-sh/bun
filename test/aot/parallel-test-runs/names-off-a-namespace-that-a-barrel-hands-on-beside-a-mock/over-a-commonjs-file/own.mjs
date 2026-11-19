import { d } from "./mid.mjs";
import * as holder from "./mid.mjs";
const read = it => it.rate;
export const byName = () => d.rate;
export const off = () => holder.d.rate;
export const byKey = key => d[key];
export const same = () => String(read(d) === d.rate);
export const called = () => d.show();
export const required = () => require("./mid.mjs").d.rate;
