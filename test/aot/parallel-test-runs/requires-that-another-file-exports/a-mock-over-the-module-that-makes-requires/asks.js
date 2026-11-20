import { load, own } from "./maker.js";
export const askWhole = () => load(import.meta.dirname + "/value.cjs");
export const askShort = () => load("./value.cjs");
export const askOwn = () => own();
