import { basename, extname } from "./barrel.mjs";
console.log("SAID user runs");
export const user = () => `${basename("/a/user.ts")} ${typeof extname === "function" ? extname("/a/user.ts") : extname}`;
