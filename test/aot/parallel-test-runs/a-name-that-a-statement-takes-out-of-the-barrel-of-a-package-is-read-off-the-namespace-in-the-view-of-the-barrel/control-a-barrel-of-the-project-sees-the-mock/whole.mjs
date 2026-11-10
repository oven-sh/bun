import * as all from "./last.mjs";
export const look = () => Object.keys(all).sort().map(key => key + "=" + all[key]).join();
