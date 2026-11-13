import * as all from "./outer.js";
import * as between from "./mid.js";
const show = all => Object.keys(all).sort().map(key => key + "=" + String(Reflect.get(all, key))).join(",");
export const look = () => "outer " + show(all) + " . mid " + show(between);
