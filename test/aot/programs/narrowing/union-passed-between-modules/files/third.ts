import type { Deep } from "./deep";
import type { S6 } from "./s6";
import type { S4 } from "./s4";
import type { Any5, Any8 } from "./any";
import { from, parse5, parse8, plain5 } from "./parse";
import { row5, row8 } from "./row";
const six: Deep<S6> = { id: "f", type: "t6", status: "idle", tags: [], meta: { at: 6 }, own6: 6, extra6: 60 };
const four: Deep<S4> = { id: "d", type: "t4", status: "idle", tags: [], meta: { at: 4 }, own4: 4, extra4: 40 };
function again(task: Deep<Any8>): Deep<Any8> { return JSON.parse(JSON.stringify(task)) as Deep<Any8>; }
function again5(task: Any5): Any5 { return JSON.parse(JSON.stringify(task)) as Any5; }
export function third(): string {
    return [row8(six), row5(four), row5(parse5('{"id":"a","type":"t1","status":"idle","tags":[],"meta":{"at":1},"own1":1}')), row8(parse8('{"id":"g","type":"t7","status":"busy","tags":[],"meta":{"at":7},"own7":7}')),
        row5(plain5('{"id":"b","type":"t2","status":"busy","tags":[],"meta":{"at":2},"own2":2,"extra2":20}')), row8(from(six)), row8(again(six)), row5(again5(plain5('{"id":"c","type":"t3","status":"idle","tags":[],"meta":{"at":3},"own3":3}')))].join(" ");
}
