import { bump, count } from "./late-barrel.js";

export const read = () => count;
export const bumpThroughBarrel = () => bump();
