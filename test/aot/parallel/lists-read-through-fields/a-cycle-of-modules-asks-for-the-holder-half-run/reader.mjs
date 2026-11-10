import { shelf } from "./shelf.mjs";
export function sum(start) { let total = start; for (let place = 0; place < shelf.rows.length; place++) total = total + shelf.rows[place]; return total; }
