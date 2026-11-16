import * as owner from "./owner.mjs";
export function probe() {
    let seen = "none";
    for (const member of Object.values(owner)) {
        try { seen = String(member()); } catch (e) { seen = e.name; }
    }
    return seen;
}
