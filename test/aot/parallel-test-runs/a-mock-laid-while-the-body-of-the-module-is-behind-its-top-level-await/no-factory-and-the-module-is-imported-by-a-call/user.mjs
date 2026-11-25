import * as all from "./part.mjs";
export const seen = () => Object.keys(all).sort().map(k => k + "=" + String(all[k])).join(",");
