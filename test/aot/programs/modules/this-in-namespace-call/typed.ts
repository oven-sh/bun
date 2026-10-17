export function self(this: unknown): unknown {
  return this
}
export const held = function (this: unknown): unknown {
  return this
}
export function ignores(): number {
  return 1
}
