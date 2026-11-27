import * as all from "pack/wide.mjs";
export const seen = () => Object.keys(all).map(key => key + "=" + all[key]).join();
