export const a = 1;
export function self(this: unknown) {
  return this;
}
export function strict(this: unknown) {
  return typeof this;
}
