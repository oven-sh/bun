const late = await import("./late.mjs");
import { first } from "./first.mjs";
console.log("end", first, typeof late.again);
