import * as all from "./outermost.mjs";
const key = JSON.parse('"round"');
export const look = () => [all.round, all[key], key in all, Object.keys(all)].join(" ");
