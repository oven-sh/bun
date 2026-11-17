export function far(value: { a: number; z: number; y: number; x: number }) {
  const { a, ...rest } = value;
  return rest;
}
