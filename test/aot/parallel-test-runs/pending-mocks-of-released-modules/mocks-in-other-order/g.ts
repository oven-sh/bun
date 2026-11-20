import { Socket } from "./w.ts";
import { log } from "./r.ts";
import { bits } from "./types.ts";
export const intents = bits;
export const codes = { closed: 4 };
export class Plugin extends Socket { own = log("g"); }
