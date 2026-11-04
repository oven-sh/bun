// Nothing else writes the field, and nothing else hands the object on.
export function made() {
  const item = { v: 1 };
  const map = new Map([["a", item]]);
  return [map.size, item.v];
}
export function setOf(items) {
  return new Set(items).size;
}
