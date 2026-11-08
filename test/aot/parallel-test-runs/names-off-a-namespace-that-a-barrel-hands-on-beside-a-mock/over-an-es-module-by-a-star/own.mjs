import { d } from "./stars.mjs";
import * as holder from "./stars.mjs";
const read = it => it.rate;
export const byName = () => d.rate;
export const off = () => holder.d.rate;
export const byKey = key => d[key];
export const same = () => String(read(d) === d.rate);
export const called = () => d.show();
export const required = () => require("./stars.mjs").d.rate;
