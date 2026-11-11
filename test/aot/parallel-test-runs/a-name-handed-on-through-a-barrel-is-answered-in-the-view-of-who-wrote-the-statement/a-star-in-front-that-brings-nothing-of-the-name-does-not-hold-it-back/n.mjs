import * as all from "./t.mjs";
export const late = () => Object.keys(all).join() + " " + all.y + " " + all.z + " " + ("z" in all) + " " + Reflect.get(all, "z") + " runs " + globalThis.runsOfPart + " " + globalThis.runsOfOther;
