(globalThis.watched ??= { objects: [], names: [], keys: [], calls: {}, ran: {} }).ran.user = (globalThis.watched.ran.user ?? 0) + 1;
import * as all from "./part.mjs";
import { x } from "./part.mjs";
export const seen = () => x + " " + all.x;
export const whole = () => all;
