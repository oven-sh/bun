import { total } from "./main.mjs";
export const early = [];
for (const turns of JSON.parse("[0, 0, 1]")) { try { early.push(String(total(turns))); } catch (e) { early.push(e.constructor.name); } }
