import { late } from "./head.mjs";
function called() { void late; }
called();
export const told = "loaded";
