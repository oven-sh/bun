import * as all from "./outer.js";
export const look = () => Object.keys(all).sort().map(key => key + "=" + String(all[key])).join(",");
