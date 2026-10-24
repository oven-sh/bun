import type { Any5, Any8 } from "./any";
import type { Deep } from "./deep";
export function make5(n: number): Any5 {
    switch (n) {
        case 1: return { id: "a", type: "t1", status: "idle", tags: [], meta: { at: 1 }, own1: 1 };
        case 2: return { id: "b", type: "t2", status: "busy", tags: [], meta: { at: 2 }, own2: 2, extra2: 20 };
        case 3: return { id: "c", type: "t3", status: "idle", tags: [], meta: { at: 3 }, own3: 3 };
        case 4: return { id: "d", type: "t4", status: "busy", tags: [], meta: { at: 4 }, own4: 4, extra4: 40 };
        default: return { id: "e", type: "t5", status: "idle", tags: [], meta: { at: 5 }, own5: 5 };
    }
}
// The same by way of a variable, so that the values meet.
export function pick5(n: number): Deep<Any5> {
    let made: Deep<Any5>;
    if (n === 1) made = { id: "a", type: "t1", status: "idle", tags: [], meta: { at: 1 }, own1: 1 };
    else if (n === 2) made = { id: "b", type: "t2", status: "busy", tags: [], meta: { at: 2 }, own2: 2, extra2: 20 };
    else if (n === 3) made = { id: "c", type: "t3", status: "idle", tags: [], meta: { at: 3 }, own3: 3 };
    else if (n === 4) made = { id: "d", type: "t4", status: "busy", tags: [], meta: { at: 4 }, own4: 4, extra4: 40 };
    else made = { id: "e", type: "t5", status: "idle", tags: [], meta: { at: 5 }, own5: 5 };
    return made;
}
export function make8(n: number): Deep<Any8> {
    if (n === 6) return { id: "f", type: "t6", status: "idle", tags: ["z"], meta: { at: 6 }, own6: 6, extra6: 60 };
    if (n === 7) return { id: "g", type: "t7", status: "busy", tags: [], meta: { at: 7 }, own7: 7 };
    if (n === 8) return { id: "h", type: "t8", status: "busy", tags: [], meta: { at: 8 }, own8: 8, extra8: 80 };
    return pick5(n);
}
