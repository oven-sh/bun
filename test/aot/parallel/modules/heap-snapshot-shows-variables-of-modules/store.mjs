export const sessions = new Map([["a", 1]]);
const cache = new Set(["x"]);
let hidden = new Set([1, 2]);
let scratch = [cache];
export function sizeOfHidden() {
  return hidden.size + cache.size + (scratch ? scratch.length : 0);
}
export function replaceHidden() {
  hidden = new Map([[3, 4]]);
}
export function dropScratch() {
  scratch = undefined;
}
