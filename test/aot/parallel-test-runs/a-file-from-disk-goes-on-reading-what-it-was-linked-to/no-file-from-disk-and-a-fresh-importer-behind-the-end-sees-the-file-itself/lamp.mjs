import * as all from "./shelf.mjs";
export const seen = () => Object.keys(all).map(key => key + "=" + all[key]).join();
