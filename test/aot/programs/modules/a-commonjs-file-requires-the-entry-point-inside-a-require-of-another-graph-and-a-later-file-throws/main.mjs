import "./first.cjs";
import { name } from "./beside.mjs";
import "./throws.cjs";
console.log("main runs beside", name);
export const answer = 42;
