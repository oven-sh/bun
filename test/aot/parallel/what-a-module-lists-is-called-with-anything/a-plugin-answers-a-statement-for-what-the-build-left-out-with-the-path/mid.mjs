import * as got from "left-out";
export function probe() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return typeof got.sum + " " + got.sum("a", "b") + " " + work;
}
