export function store(target: any, value: unknown) {
  target.One = value;
}
function assign(target: any, key: string, value: unknown) {
  const held = target;
  held[key] = value;
}
export function storeUnderKey(target: any, key: string, value: unknown) {
  assign(target, key, value);
}
export function count(target: any) {
  return Object.keys(target).length;
}
