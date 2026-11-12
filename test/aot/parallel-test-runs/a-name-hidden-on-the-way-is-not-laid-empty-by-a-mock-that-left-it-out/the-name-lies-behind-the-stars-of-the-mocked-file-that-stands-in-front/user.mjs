import * as barrel from "./wide.mjs";
export const say = () => barrel.round + " " + barrel.only + " " + Object.keys(barrel).join();
