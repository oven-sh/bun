import * as all from "./last.mjs";
export const look = () => Object.keys(all).map(key => key + "=" + all[key]).join();
