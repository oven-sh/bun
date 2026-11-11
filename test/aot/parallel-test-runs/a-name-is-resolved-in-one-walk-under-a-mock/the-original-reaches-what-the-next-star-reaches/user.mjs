import * as all from "./wide.mjs";
import { round } from "./wide.mjs";
export const look = () => Object.keys(all).join() + " " + String(Reflect.get(all, "round")) + " " + String(round);
