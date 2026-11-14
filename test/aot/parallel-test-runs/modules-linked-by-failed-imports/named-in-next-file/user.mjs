import * as all from "./barrel.mjs";
export const look = () => Object.keys(all).join() + "/" + typeof all.kept + "/" + (typeof all.kept === "function" ? "fn" : all.kept) + "/" + all.left;
