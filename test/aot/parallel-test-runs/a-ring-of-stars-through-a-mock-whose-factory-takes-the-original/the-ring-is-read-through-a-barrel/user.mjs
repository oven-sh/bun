import * as all from "./outer.mjs";
export const look = () => Object.keys(all).sort().join() + " " + String(all.round) + " " + String(Reflect.get(all, "round")) + " " + String(all.square);
