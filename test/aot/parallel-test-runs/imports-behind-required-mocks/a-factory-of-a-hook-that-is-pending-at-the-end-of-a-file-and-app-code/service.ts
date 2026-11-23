import { get, put } from "./store.ts";
export const load = () => "<" + get() + " " + put() + ">";
