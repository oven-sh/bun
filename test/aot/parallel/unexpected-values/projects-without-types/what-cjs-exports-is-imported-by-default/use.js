export const size = value => value.length;
export const first = value => value[0];
export const doubled = value => value.map(item => item * 2);
export function total(value) {
  let sum = 0;
  for (const item of value) sum += item;
  return sum;
}
export const plusOne = value => value + 1;
export const isList = value => Array.isArray(value);
export const text = value => String(value);
