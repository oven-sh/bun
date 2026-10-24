export const value: number = Number("42");

export function sum(count: number): number {
  let total = 0;
  for (let index = 0; index < count; index++) total += value;
  return total;
}
