import { call, replace } from "./inner-a.js";
export const seen = call() + replace()() + call();
