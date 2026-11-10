import { grind } from "./tools.cjs";
export function useName(n) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return grind(n + work - 1);
}
