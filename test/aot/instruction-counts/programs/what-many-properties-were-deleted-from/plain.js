const make = () => ({ count: 0, size: 0 });
const use = made => {
  for (let i = 0; i < 200; i++) made["k" + i] = i;
  for (let i = 0; i < 190; i++) delete made["k" + i];
  return made;
};
const touch = made => {
  made.count = made.count + made.size;
  return "count" in made;
};
export const plain = [make(), make(), make(), make()];
let used;
let usedAgain;
export const fresh = () => (used ??= [use(make()), use(make()), use(make()), use(make())]);
export const settled = () =>
  (usedAgain ??= [0, 1, 2, 3].map(() => {
    const made = make();
    for (let round = 0; round < 3; round++) {
      use(made);
      for (let i = 0; i < 5; i++) touch(made);
    }
    return made;
  }));
export function theLoopAlone(list, n) {
  let s = 0;
  for (let i = 0; i < n; i++) if (list[i & 3] !== undefined) s++;
  return s;
}
export function stores(list, n) {
  for (let i = 0; i < n; i++) list[i & 3].count = i;
  return list[0].count;
}
export function storesByKey(list, n) {
  for (let i = 0; i < n; i++) list[i & 3][i & 4 ? "count" : "size"] = i;
  return list[0].count;
}
export function reads(list, n) {
  let s = 0;
  for (let i = 0; i < n; i++) if (list[i & 3].count !== undefined) s++;
  return s;
}
export function readsByKey(list, n) {
  let s = 0;
  for (let i = 0; i < n; i++) if (list[i & 3][i & 4 ? "count" : "size"] !== undefined) s++;
  return s;
}
