import type { Any3, Any5, Any8 } from "./any";
import type { Deep } from "./deep";
export function row3(task: Deep<Any3>): string { return task.type + task.status + task.meta.at; }
export function row5(task: Deep<Any5>): string { return task.type + task.status + task.meta.at; }
export function row8(task: Deep<Any8>): string {
    switch (task.type) {
        case "t1": return "one" + task.own1;
        case "t8": return "eight" + task.own8 + task.extra8;
        default: return task.type + task.status + task.tags.length;
    }
}
