import { deep } from "./below.js";
console.log("dep runs");
export const dep = () => "real " + deep();
