import * as all from "./wide.mjs";
export const look = () => [all.count, all.painted, all.own, all.only].join(" ") + " " + Object.keys(all).join();
