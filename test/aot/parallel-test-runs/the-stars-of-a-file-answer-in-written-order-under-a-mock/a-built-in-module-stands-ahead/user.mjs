import * as all from "./wide.mjs";
import { sep } from "./wide.mjs";
export const look = () => Object.keys(all).includes("sep") + " " + Reflect.get(all, "sep") + " " + sep;
