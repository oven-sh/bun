import * as all from "./one.mjs";
export const look = () => String(all.sep) + " " + String(Reflect.get(all, "sep"));
