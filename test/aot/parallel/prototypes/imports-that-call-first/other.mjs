import { make, create } from "./main.mjs";
const made = make();
export const first = [Object.getPrototypeOf(made) === Object.prototype, typeof made.area, typeof made.toString].join();
export let second;
try { second = typeof create().area; } catch (error) { second = error.constructor.name; }
