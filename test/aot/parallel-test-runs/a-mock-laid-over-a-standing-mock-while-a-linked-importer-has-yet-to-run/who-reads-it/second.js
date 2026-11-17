import { who } from "./dep.js";
import * as all from "./dep.js";
export const seen = () => who;
export const names = () => Object.keys(all).sort().join("+");
export const read = name => { try { return String(all[name]); } catch { return "threw"; } };
