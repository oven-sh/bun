export function one(value: { skipped: number; run: () => number; size: number }) {
  const { skipped, ...rest } = value;
  return rest;
}
