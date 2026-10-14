import type { Any8 } from "./any";
import type { Deep } from "./deep";
import type { S3 } from "./s3";
import { make5, make8 } from "./make";
import { row5, row8 } from "./row";
export function whole(task: Deep<Any8>): string { return row8(task); }
export function narrowed(task: Deep<Any8>): string {
    if (task.type === "t1") return "first";
    if (task.type === "t8") return "last";
    return row8(task);
}
export function one(task: Deep<S3>): string { return row8(task); }
export function calls(): string {
    const all: string[] = [];
    for (let n = 1; n <= 8; n++) all.push(whole(make8(n)), narrowed(make8(n)));
    for (let n = 1; n <= 5; n++) all.push(row5(make5(n)));
    all.push(one({ id: "c", type: "t3", status: "busy", tags: ["q"], meta: { at: 3 }, own3: 3 }));
    return all.join(" ");
}
