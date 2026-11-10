import * as top from "./top.mjs";
import * as giver from "./giver.mjs";
export const look = () => "top " + top.round + " giver " + giver.round + " names " + Object.keys(top).sort().join();
