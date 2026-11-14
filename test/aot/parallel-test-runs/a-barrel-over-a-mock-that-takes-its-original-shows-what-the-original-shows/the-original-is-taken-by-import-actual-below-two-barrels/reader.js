import * as all from "./attic1.js";
export const look = () => Object.keys(all).sort().map(key => key + "=" + typeof all[key]).join() + " " + all.held;
