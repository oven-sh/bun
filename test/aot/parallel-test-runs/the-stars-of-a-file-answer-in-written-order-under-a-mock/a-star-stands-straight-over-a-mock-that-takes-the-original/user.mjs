import * as all from "./wide.mjs";
export const look = () => Object.keys(all).join() + " " + Reflect.get(all, "round") + " " + all.square;
