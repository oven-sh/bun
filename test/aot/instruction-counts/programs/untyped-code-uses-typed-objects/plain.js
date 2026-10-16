export function makePlain() {
  return { name: "a", next: undefined, sides: 3 };
}
export function theLoopAlone(list, n) {
  let s = 0;
  for (let i = 0; i < n; i++) if (list[i & 3] !== undefined) s++;
  return s;
}
export function storesNumber(list, n) {
  for (let i = 0; i < n; i++) list[i & 3].sides = i;
  return list[0].sides;
}
export function storesString(list, n, v) {
  for (let i = 0; i < n; i++) list[i & 3].name = v;
  return list[0].name;
}
export function storesObject(list, n, v) {
  for (let i = 0; i < n; i++) list[i & 3].next = v;
  return list[0].next === v;
}
export function readsNumber(list, n) {
  let s = 0;
  for (let i = 0; i < n; i++) if (list[i & 3].sides !== undefined) s++;
  return s;
}
export function readsString(list, n) {
  let s = 0;
  for (let i = 0; i < n; i++) if (list[i & 3].name !== undefined) s++;
  return s;
}
export function readsObject(list, n) {
  let s = 0;
  for (let i = 0; i < n; i++) if (list[i & 3].next !== undefined) s++;
  return s;
}
export function readsOptional(list, n) {
  let s = 0;
  for (let i = 0; i < n; i++) if (list[i & 3].label === undefined) s++;
  return s;
}
