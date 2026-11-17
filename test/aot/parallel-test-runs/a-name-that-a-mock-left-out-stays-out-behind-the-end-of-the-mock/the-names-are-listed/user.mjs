import * as all from "./barrel.mjs";
export const look = () => [Object.keys(all).join(), "leftOut" in all, Reflect.get(all, "kept"), Reflect.get(all, "leftOut")].join(" ");
