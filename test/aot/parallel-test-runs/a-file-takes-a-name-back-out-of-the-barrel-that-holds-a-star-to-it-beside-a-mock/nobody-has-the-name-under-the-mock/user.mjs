import * as all from "./last.mjs";
import * as barrel from "./wide.mjs";
export const look = () => [Object.keys(all).join(), String(all.square), "|", Object.keys(barrel).join(), String(barrel.square)].join(" ");
