// RUN: link
// STATISTIC: MaxSupertypePairsHits = 0
// CHECK: function {{*}}name="f"

// Each step through `next` is a new instantiation, one array deeper, that nobody else asks the checker for. The walk stops two levels below the flow into `t`, long before the limit on pairs.
interface List<T> {
  next: List<T[]> | null;
  size: number;
}

interface Twin<T> {
  next: Twin<T[]> | null;
}

export function f(l: List<number>) {
  const t: Twin<number> = l;
  return t;
}
