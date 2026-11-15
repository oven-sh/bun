export function two(value: { skipped: number; run: () => number; size: number }) {
  const { skipped, ...rest } = value;
  return rest;
}
