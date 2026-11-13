import * as all from "./last.mjs";
import { round } from "./last.mjs";
export const look = () => Object.keys(all).map(key => key + "=" + all[key]).join() + " named " + round;
