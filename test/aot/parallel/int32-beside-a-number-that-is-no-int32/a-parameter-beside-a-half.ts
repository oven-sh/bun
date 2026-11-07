import type { int32 } from "bun";

function widen(step: int32 | 0.5): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return step * 2 + work;
}

console.log(widen(3));
