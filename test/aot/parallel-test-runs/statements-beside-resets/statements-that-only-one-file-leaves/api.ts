import { get, name } from "./db.ts";
console.log("the api runs");
export const read = () => get() + " " + name();
