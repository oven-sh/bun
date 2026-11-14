import * as all from "./barrel.mjs";
export const look = () => Object.keys(all).sort().join() + " " + String(all.get) + " " + String(all.helper) + " " + String(all.only);
