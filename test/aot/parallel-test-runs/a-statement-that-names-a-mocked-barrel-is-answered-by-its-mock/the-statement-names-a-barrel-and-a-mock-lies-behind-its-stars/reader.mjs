import * as town from "./town.mjs";
export const look = () => Object.keys(town).join() + " " + String(town.elm);
