import * as api from "./api.ts";
console.log("the page runs");
export const show = () => "[" + api.read() + "]";
