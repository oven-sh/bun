import { name as one } from "./one";
import { name as two } from "./two";
import { name as three } from "./three";

console.log("top runs");
export const names = () => [one, two, three].join(", ");
