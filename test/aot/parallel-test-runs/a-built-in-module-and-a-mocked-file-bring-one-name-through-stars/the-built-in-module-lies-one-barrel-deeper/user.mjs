import * as all from "./wide.mjs";
import { sep } from "./wide.mjs";
export const look = () => [Reflect.get(all, "sep"), all.sep, sep, "dash" in all].map(String).join(" ");
