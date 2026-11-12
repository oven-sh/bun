export const fixed = { port: 80, name: "x", nested: { deep: true }, half: 1.5, zero: -0, none: null, missing: undefined };
export const changedByName = { port: 80 };
export const changedByKey = { port: 80, name: "x" };
export const changedByBuiltin = { port: 80 };
export const changedLater = { port: 80 };
export function make() {
  return { kind: "made", count: 1 };
}
