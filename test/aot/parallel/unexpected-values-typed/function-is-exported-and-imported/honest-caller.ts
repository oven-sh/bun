import code, { halved, Scale, sum, total } from "./library.ts";

export function honestElsewhere(n: number): number {
  return total([n, 1]) + sum({ x: n, y: 1 }) + code("k") + halved(n) + new Scale(n).apply(2);
}
