import * as ring from "./wide.mjs";
export const look = () => Object.keys(ring).sort().join() + ":" + String(ring.round);
