import { order } from "./log.mjs";
import { name as nameOfA } from "./a.mjs";
order.push("b");
export const name = "b";
export const readA = () => { try { return nameOfA; } catch (e) { return e.constructor.name; } };
