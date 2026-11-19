import * as all from "./last.mjs";
import * as barrel from "./wide.mjs";
export const look = () => Object.keys(all).join() + " | " + Object.keys(barrel).join();