import { feature } from "bun:bundle";
const OFF = false;
if (OFF) require("./extra.cjs");
const frozen = Object.freeze({ size: 1 }) as { size: number };
let outcome = "silent";
try { frozen.size = 2; } catch (error) { outcome = (error as Error).name; }
function self(this: unknown) { return this === undefined; }
console.log(outcome, self());
