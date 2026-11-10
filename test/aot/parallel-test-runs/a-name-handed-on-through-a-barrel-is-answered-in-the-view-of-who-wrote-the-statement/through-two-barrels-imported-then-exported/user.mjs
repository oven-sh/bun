import * as all from "./barrel.mjs";
export const look = () => Object.keys(all).join() + " " + [all.early, all.kept, all.both, all.own].join(" ");
