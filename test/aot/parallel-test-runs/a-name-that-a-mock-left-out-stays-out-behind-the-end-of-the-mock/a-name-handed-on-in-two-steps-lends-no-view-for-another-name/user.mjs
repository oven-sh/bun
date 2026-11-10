import * as all from "./barrel.mjs";
export const look = (...names) => names.map(name => name + " " + (name in all) + " " + String(Reflect.get(all, name))).join(", ");
