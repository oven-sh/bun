import * as all from "./handed.mjs";
export const look = () => Object.keys(all).sort().join() + " " + String(all.round);
