import * as all from "./barrel.js";

export const hand = () => all;
export const readOffImport = () => [all.fn(), String(all.added), Object.keys(all).sort().join("+")].join();
