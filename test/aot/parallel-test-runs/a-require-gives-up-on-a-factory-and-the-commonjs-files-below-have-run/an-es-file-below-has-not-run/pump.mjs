import { reading } from "./gauge.mjs";
import { state } from "./valve.mjs";
export const seen = "pump " + reading + " " + state;
