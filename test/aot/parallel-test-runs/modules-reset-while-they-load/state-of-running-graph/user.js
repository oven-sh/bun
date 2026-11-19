import { add, items } from "./store.js";
add("user");
export const seen = () => items.length;
