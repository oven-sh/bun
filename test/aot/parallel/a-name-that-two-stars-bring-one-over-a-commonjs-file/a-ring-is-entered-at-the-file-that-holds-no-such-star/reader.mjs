import { depth as named } from "./wide.mjs";
import * as all from "./wide.mjs";
const key = JSON.parse('"depth"');
export const look = () => [named, all[key], key in all].join("/");
import "./back.mjs";
