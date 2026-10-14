import type { Deep } from "./deep";
import type { S2 } from "./s2";
import type { S1 } from "./s1";
import type { S4 } from "./s4";
import { row3, row5, row8 } from "./row";
const two: Deep<S2> = { id: "b", type: "t2", status: "busy", tags: ["x", "y"], meta: { at: 2 }, own2: 2, extra2: 20 };
const one: Deep<S1> = { id: "a", type: "t1", status: "idle", tags: [], meta: { at: 1 }, own1: 1 };
const four: Deep<S4> = { id: "d", type: "t4", status: "idle", tags: [], meta: { at: 4 }, own4: 4, extra4: 40 };
export function second(): string { return [row8(two), row8(one), row5(four), row3(two)].join(" "); }
