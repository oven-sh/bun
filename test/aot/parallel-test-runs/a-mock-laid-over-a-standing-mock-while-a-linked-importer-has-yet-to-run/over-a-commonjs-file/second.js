import { who } from "./dep.cjs";
import * as all from "./dep.cjs";
export const seen = () => who;
export const names = () => Object.keys(all).sort().join("+");
export const read = name => { try { return String(all[name]); } catch { return "threw"; } };
