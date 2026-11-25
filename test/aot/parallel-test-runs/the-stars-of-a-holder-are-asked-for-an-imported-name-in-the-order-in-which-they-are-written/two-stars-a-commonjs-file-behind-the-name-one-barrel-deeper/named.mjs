import { round } from "./holder.mjs";
export const look = () => typeof round === "function" ? "builtin" : String(round);
