import * as all from "./wide.mjs";
export const look = () => Object.keys(all).join() + " " + all.round + " " + all.square + " " + ("square" in all) + " " + Reflect.get(all, "square");
