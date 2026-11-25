import * as all from "./wide.mjs";
export const look = () => Object.keys(all).join() + " " + all.round + " " + Reflect.get(all, "round") + " " + ("square" in all);
