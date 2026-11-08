import * as all from "./holder.mjs";
export const look = () => typeof all.join === "function" ? "builtin" : String(all.join);
