import grind from "./real.cjs";
export function use(n) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return grind(n + work - 1);
}
