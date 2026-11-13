import * as all from "./between.mjs";
const safe = take => { try { return String(take()); } catch (error) { return error.constructor.name; } };
export const late = () => safe(() => all.sep) + " " + safe(() => Reflect.get(all, "sep"));
