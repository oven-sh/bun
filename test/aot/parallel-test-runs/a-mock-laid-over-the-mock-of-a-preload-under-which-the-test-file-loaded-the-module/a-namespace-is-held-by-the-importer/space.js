import * as all from "./dep.js";
export const viaSpace = () => Object.keys(all).sort().join("+") + " " + all.who;
