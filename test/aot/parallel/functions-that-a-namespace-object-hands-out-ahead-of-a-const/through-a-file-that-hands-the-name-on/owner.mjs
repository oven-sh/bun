import "./early.mjs";
const late = 5;
export function readLate() {
    let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
    return late + work;
}
