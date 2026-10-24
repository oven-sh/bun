import type { Deep } from "./deep";
import type { S8 } from "./s8";
import type { S7 } from "./s7";
import type { S5 } from "./s5";
import type { S3 } from "./s3";
import { row3, row5, row8 } from "./row";
const eight: Deep<S8> = { id: "h", type: "t8", status: "busy", tags: ["x"], meta: { at: 8 }, own8: 8, extra8: 80 };
const seven: Deep<S7> = { id: "g", type: "t7", status: "idle", tags: [], meta: { at: 7 }, own7: 7 };
const five: Deep<S5> = { id: "e", type: "t5", status: "idle", tags: [], meta: { at: 5 }, own5: 5 };
const three: Deep<S3> = { id: "c", type: "t3", status: "busy", tags: [], meta: { at: 3 }, own3: 3 };
export function first(): string { return [row8(eight), row8(seven), row5(five), row3(three)].join(" "); }
