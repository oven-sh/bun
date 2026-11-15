import { g } from "./y";
import * as y from "./y";
console.log("SAID body", typeof g);
export const f = () => [g(), y.g(), Object.keys(y).join("+")].join();
