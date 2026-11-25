import * as all from "./wide.mjs";
export const look = () => Object.keys(all).sort().join() + " " + ("round" in all) + " " + String(Reflect.get(all, "round")) + " " + String(all.own);
