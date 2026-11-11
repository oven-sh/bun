import * as all from "./outer.mjs";
export const look = () => Object.keys(all).join() + " " + Reflect.get(all, "round") + " " + all.square + " " + all.only;
