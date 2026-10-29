export { custom, countedA } from "bun";
export * as all from "bun";
import { custom } from "./chain.mjs";
note("reexports.mjs starts");
export const read = () => custom;
