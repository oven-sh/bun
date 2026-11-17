import type { int32 } from "bun";
const enum Size { Small = 1, Huge = 1e12 }
function widen(step: int32 | Size): number { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return step + work; }
console.log(widen(3), widen(Size.Huge));
