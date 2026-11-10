import * as all from "./outer.js";
const mine = new Set(["kept", "both", "extra", "other", "sep", "default"]);
const safe = take => { try { return String(take()); } catch (error) { return error.constructor.name; } };
export const look = () => Object.keys(all).filter(key => mine.has(key)).sort().map(key => key + "=" + safe(() => Reflect.get(all, key))).join() + " written " + safe(() => all.kept) + " " + ("kept" in all);
