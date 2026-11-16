import * as tools from "./maker.js";
export const askWhole = () => tools.load(import.meta.dirname + "/value.cjs");
export const askShort = () => tools.load("./value.cjs");
