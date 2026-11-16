import * as all from "./above.mjs";
export const look = () => Object.keys(all).sort().join() + " " + ("round" in all) + " " + String(Reflect.get(all, "round")) + " " + String(all.own);
