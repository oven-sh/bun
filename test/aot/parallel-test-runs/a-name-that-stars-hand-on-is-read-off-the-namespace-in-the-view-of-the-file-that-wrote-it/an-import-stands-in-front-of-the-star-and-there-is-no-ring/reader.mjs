import * as all from "./shelf.mjs";
export const look = () => Object.keys(all).join() + " " + all.first + " " + all.count;
