import * as all from "./shelf.js";
export const look = () => Object.keys(all).sort().map(key => key + "=" + typeof all[key]).join() + " " + all.held;
