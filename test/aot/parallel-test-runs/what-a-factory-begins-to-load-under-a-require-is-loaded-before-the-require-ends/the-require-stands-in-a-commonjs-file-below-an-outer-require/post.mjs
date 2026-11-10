import { first } from "./first.cjs";
import { second } from "./second.cjs";
import { oil } from "./oil.mjs";
globalThis.log.push("post");
export const post = () => first + " " + second + " " + oil;
