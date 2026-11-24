import { load } from "./svc.ts";
console.log("the page runs");
export const show = () => "[" + load() + "]";
