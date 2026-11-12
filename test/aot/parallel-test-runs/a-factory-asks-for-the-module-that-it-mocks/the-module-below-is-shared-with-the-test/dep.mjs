import { bump } from "./low.mjs"; import { who } from "./other.mjs"; import * as all from "./low.mjs"; export * from "./low.mjs";
export const first = bump(); export const sees = who; export const keys = Object.keys(all).join();
