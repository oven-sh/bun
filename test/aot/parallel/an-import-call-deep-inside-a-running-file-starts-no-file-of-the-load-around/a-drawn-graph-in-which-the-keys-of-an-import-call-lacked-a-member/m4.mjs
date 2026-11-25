import { t6 } from "./m6.cjs";
import { t9 } from "./m9.mjs";
(globalThis.waits ??= []).push(import("./m7.mjs").then(names => "m4>" + Object.keys(names).sort().slice(0, 3).join("+")));
export const t4 = "m4(" + [t6, t9].join() + ")";
