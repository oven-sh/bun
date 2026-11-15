/** @import { count } from "./nothing.js" */
let count = 1;
export { count };
export const bump = () => ++count;
