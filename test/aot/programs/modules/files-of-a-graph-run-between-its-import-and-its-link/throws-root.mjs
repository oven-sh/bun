import { value as a } from "./throws-a.cjs";
import { value as b } from "./throws-b.cjs";
import { value as c } from "./throws-c.cjs";
globalThis.log.push("throws-root");
export const total = a + b + c;
