import registry from "./registry.cjs";
registry.emit();
export const one = 1;
export function bump() {
  return one + 1;
}
