import { ownLength } from "./main";
let early: string;
try { early = String(ownLength()); } catch (error: any) { early = error.constructor.name; }
export const fromOther = early;
