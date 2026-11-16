import * as dep from "./dep.mjs";
import { d } from "./mid.mjs";
import * as mid from "./mid.mjs";
const show = it => it.value();
const read = (it, key) => it[key];
export const reflected = () => show(Reflect.get(mid, "d"));
export const byKey = key => show(read(mid, key));
export const byName = () => { const said = []; for (let i = 0; i < 40; i++) said.push(show(d)); return said[0] + ".." + said[39] + " " + new Set(said).size; };
export const same = () => String(d === dep);
