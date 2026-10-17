const make = () => ({ count: 0, size: 0 });
const addAndDeleteMany = object => {
  for (let i = 0; i < 200; i++) object["k" + i] = i;
  for (let i = 0; i < 190; i++) delete object["k" + i];
  return object;
};
const readAndWrite = object => {
  object.count = object.count + object.size;
  return "count" in object;
};
export const plain = [make(), make(), make(), make()];
let cachedDictionaries;
let cachedPermanentDictionaries;
export const dictionaries = () => (cachedDictionaries ??= [addAndDeleteMany(make()), addAndDeleteMany(make()), addAndDeleteMany(make()), addAndDeleteMany(make())]);
export const permanentDictionaries = () =>
  (cachedPermanentDictionaries ??= [0, 1, 2, 3].map(() => {
    const object = make();
    for (let round = 0; round < 3; round++) {
      addAndDeleteMany(object);
      for (let i = 0; i < 5; i++) readAndWrite(object);
    }
    return object;
  }));
export function emptyLoop(list, n) {
  let s = 0;
  for (let i = 0; i < n; i++) if (list[i & 3] !== undefined) s++;
  return s;
}
export function store(list, n) {
  for (let i = 0; i < n; i++) list[i & 3].count = i;
  return list[0].count;
}
export function storeByKey(list, n) {
  for (let i = 0; i < n; i++) list[i & 3][i & 4 ? "count" : "size"] = i;
  return list[0].count;
}
export function read(list, n) {
  let s = 0;
  for (let i = 0; i < n; i++) if (list[i & 3].count !== undefined) s++;
  return s;
}
export function readByKey(list, n) {
  let s = 0;
  for (let i = 0; i < n; i++) if (list[i & 3][i & 4 ? "count" : "size"] !== undefined) s++;
  return s;
}
