import * as all from "./last.mjs";
export const look = () =>
  Object.keys(all)
    .map(k => k + "=" + all[k])
    .join();
