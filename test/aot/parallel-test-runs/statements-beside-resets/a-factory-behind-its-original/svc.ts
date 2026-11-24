import { get } from "./api.ts";
console.log("the service runs");
export const load = () => "<" + get() + ">";
