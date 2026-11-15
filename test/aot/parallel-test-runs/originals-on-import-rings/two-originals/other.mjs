import { order } from "./log.mjs";
import * as ring from "./a.mjs";
order.push("other");
export const other = "real";
export const seesRing = () => { try { return ring.name;
} catch (e) { return e.constructor.name;
} };
