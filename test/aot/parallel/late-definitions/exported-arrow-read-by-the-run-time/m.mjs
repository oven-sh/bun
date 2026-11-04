import * as self from "./m.mjs";
export function peek(name) { try { return typeof self[name]; } catch (e) { return e.name; } }
export function direct() { try { return typeof arrow; } catch (e) { return e.name; } }
export const early = [peek("arrow"), peek("named"), peek("pattern"), peek("table"), direct()].join();
export const arrow = x => x + 1;
export const named = function inner() { return inner; };
export const pattern = /p/g;
export const table = { a: 1 };
export const readArrow = () => arrow;
export const readNamed = () => named;
export const never = () => "never read by compiled code";
