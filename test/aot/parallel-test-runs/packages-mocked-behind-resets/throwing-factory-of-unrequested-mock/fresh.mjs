import { types } from "./types.mjs";
import { more } from "@made-up/relay";
console.log("fresh runs");
export const fresh = () => "fresh " + types() + more;
