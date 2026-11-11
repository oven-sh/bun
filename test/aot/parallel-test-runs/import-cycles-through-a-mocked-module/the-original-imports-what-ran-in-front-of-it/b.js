import { order } from "./log.js"; import { name } from "./a.js"; order.push("b"); export const readA = () => { try { return name; } catch (e) { return e.constructor.name; } };
