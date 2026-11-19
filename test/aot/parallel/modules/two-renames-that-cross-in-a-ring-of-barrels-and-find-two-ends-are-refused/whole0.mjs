import * as all from "./wide.mjs";
const key = process.argv.length > 90 ? "none" : "flat";
export const look = () => [all.flat, all[key], "flat" in all, Object.keys(all).filter(key => key !== "module.exports").join()].join(" ");
