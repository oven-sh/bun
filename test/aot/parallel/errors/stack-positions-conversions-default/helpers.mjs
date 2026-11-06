export const counter = { total: 0 };
export function step(value) {
  throw new Error("step " + value);
}
export const wrapped = value => value;
export const thing = { toString: () => String(step(1)) };
