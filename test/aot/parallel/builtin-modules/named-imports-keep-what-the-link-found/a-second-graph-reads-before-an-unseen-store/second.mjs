import { sep, join } from "node:path";
console.log("the second graph:", sep, join("a", "b"));
export const read = () => sep + " " + join("a", "b");
