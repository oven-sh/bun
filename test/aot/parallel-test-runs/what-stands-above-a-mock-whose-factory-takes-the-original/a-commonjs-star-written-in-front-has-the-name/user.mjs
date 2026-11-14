import * as all from "./last.mjs";
export const look = () => Object.keys(all).sort().join() + " " + String(all.round) + " " + String(Reflect.get(all, "round")) + " " + String(all.only);
