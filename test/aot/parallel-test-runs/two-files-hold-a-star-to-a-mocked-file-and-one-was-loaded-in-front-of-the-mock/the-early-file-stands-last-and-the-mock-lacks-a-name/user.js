import * as all from "./wide.js";
export const look = () => Object.keys(all).sort().map(key => key + "=" + String(Reflect.get(all, key))).join(",");
