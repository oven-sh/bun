import snapshot, { alias, current } from "./state.js";

export const size = () => current.length;
export const first = () => current[0];
export const plusOne = () => current + 1;
export const times = () => current * 2;
export const pushed = () => current.push(9);
export function walked() {
  const seen = [];
  for (const item of current) seen.push(item);
  return seen;
}
export const called = () => current();
export const kind = () => typeof current;
export const isList = () => Array.isArray(current);
export const throughTheAlias = () => alias.length;
export const snapshotSize = () => snapshot.length;
export const same = () => [alias === current, snapshot === current];
