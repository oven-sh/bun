import * as barrel from "./wide.mjs";
export const look = () => Object.keys(barrel).join() + " " + String(barrel.round) + " " + String(barrel.square);
