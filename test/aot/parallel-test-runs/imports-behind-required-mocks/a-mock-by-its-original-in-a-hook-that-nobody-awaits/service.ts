import { get, put } from "./store.ts";
console.log("the service runs");
export const load = () => "<" + get() + " " + put() + ">";
