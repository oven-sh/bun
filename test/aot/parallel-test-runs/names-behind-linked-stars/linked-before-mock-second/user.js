import * as all from "./outer.js";
const get = k => { try { return String(Reflect.get(all, k)); } catch (e) { return "threw " + e.message; } };
export const look = (...names) => { try { return Object.keys(all).join() + " | " + names.map(get).join(" "); } catch (e) { return "threw " + e.message; } };
