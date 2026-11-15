import { url } from "./env.mjs";
import { list } from "./store.mjs";

export const start = () => url + " " + list();
