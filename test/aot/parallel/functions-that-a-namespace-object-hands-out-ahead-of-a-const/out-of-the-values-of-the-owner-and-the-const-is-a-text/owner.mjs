import { probe } from "./early.mjs";
const seen = probe();
const late = ["a", "b"].join("-");
console.log(seen);
export function readLate() {
    let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
    return late.length + work;
}
