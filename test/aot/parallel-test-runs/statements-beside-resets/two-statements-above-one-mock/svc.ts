import { get } from "./api.ts";
console.log("the service runs", typeof get);
export const load = () => "<" + get() + ">";
