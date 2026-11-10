import * as all from "./barrel.mjs";
export const look = (...names) => [Reflect.ownKeys(all).filter(key => typeof key === "string").join(), ...names.map(name => String(Reflect.get(all, name)))].join(" ");
