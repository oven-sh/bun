import "./helper";
import byDefault, { constant, declared, Made, old, renamed, variable } from "./tax";

console.log("ring");
export const name = "ring";
export const read = () => [constant, variable, old, declared(), new Made().is, byDefault, renamed].join();
