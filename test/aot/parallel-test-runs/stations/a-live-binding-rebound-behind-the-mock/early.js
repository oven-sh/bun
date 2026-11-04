import { bump, count } from "./barrel.js";

export const read = () => count;
export const bumpThroughBarrel = () => bump();
