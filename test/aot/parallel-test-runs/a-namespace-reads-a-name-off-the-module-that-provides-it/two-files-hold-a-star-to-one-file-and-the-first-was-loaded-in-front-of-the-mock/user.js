import * as all from "./wide.js";
export const look = name => (name in all) + " " + String(Reflect.get(all, name));
