import { swap, type Pair } from "built-too";

export function difference(pair: Pair): number {
  const swapped = swap(pair);
  return swapped.first - swapped.second;
}
