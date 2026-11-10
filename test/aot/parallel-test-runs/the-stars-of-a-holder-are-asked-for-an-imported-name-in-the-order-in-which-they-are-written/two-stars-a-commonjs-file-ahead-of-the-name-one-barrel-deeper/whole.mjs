import * as all from "./holder.mjs";
export const look = () => typeof all.round === "function" ? "builtin" : String(all.round);
