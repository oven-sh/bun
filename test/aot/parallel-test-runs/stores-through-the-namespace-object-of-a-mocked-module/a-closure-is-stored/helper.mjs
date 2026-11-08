import * as lib from "./lib.mjs";
import { rate } from "./lib.mjs";
export function before() { return rate() + 1; }
export function swap() { lib.rate = () => 41; return before() + ":" + (rate() + 1); }
