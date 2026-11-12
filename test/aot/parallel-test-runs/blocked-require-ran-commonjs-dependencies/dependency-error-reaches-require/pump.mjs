import { state } from "./valve.mjs";
import gauge from "./gauge.cjs";
export const seen = "pump " + gauge.reading + " " + state;
