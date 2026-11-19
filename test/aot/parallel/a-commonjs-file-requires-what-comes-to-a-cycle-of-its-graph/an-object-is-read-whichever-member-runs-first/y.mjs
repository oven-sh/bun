import "./x.mjs";
export function readLate() {
    let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
    return late.depth + work;
}
const late = { depth: 5, name: "late" };
globalThis.declared = true;
