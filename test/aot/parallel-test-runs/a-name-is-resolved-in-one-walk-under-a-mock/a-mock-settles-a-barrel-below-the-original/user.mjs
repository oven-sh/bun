import * as all from "./wide.mjs";
export const look = () => ("round" in all) + " " + String(Reflect.get(all, "round"));
