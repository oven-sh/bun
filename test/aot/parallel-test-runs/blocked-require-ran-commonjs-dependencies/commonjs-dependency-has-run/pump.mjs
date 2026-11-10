import gauge from "./gauge.cjs";
import { state } from "./valve.mjs";
export const seen = "pump " + gauge.reading + " " + state;
