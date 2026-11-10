import * as all from "./wide.mjs";
const show = all => Object.keys(all).sort().map(key => key + "=" + String(Reflect.get(all, key))).join(",");
export const look = () => show(all) + " has " + ("added" in all) + " " + String(all.added);
