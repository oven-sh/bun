import * as all from "./other.mjs";
const key = process.argv.length > 90 ? "none" : "round";
export const look = () => [all.round, all[key], "round" in all, Object.keys(all).filter(key => key !== "module.exports").join()].join(" ");
