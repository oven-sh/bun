// `inner/` is written with `strict` alone, the program with `exactOptionalPropertyTypes` too.
import { clear, type Box } from "./inner/deletes.ts";
const box: Box = { value: 1, size: 2 };
export function clearHere(own: Box): void { delete own.value; }
console.log(clear(box));
