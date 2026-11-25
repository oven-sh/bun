import "./common.js";
import * as all from "./attic0.js";
export const look = () => Object.keys(all).sort().map(key => key + "=" + typeof all[key]).join() + " " + all.held;
