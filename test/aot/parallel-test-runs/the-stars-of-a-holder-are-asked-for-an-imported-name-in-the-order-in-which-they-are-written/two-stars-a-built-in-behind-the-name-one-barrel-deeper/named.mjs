import { join } from "./holder.mjs";
export const look = () => typeof join === "function" ? "builtin" : String(join);
