import { value, change } from "./changes-file.cjs";
globalThis.log.push("changes-first");
export const total = value;
export const read = () => value;
export { change };
