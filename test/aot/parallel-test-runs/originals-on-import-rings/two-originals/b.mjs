import { order } from "./log.mjs";
import { name } from "./a.mjs";
order.push("b");
export const readA = () => { try { return name;
} catch (e) { return e.constructor.name;
} };
