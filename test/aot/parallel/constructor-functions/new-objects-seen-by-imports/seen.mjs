export const kept = [];
export function see(value) {
  return typeof value.size;
}
export function readFirst(extra, value) {
  return value.size?.inner;
}
export const keep = (value) => {
  kept.push(value);
  return Object.keys(value).length;
};
