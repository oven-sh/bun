import * as all from "kit/hub.mjs";
export const look = () => Object.keys(all).sort().map(key => key + "=" + String(Reflect.get(all, key))).join() + " " + ("missing" in all);
