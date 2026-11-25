import * as all from "./barrel.mjs";
export const look = () => [Object.keys(all).join(), all.kept, all.leftOut].join(" ");
