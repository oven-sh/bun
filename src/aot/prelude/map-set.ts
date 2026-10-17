declare function $collectionTable(c: unknown): unknown;
declare function $mapNext(m: unknown, table: unknown, entry: number): number;
declare function $mapKeyAt<K>(m: unknown, entry: number): K;
declare function $mapValueAt<V>(m: unknown, entry: number): V;
declare function $setNext(s: unknown, table: unknown, entry: number): number;
declare function $setKeyAt<T>(s: unknown, entry: number): T;
declare function $call<R>(f: unknown, thisArg: unknown, ...args: unknown[]): R;
declare function $isOriginalArray(x: unknown): boolean;

export function Map$forEach<K, V>(m: Map<K, V>, f: unknown, thisArg: unknown): void {
  if (typeof f !== "function") throw new TypeError("Map.prototype.forEach callback must be a function");
  let table = $collectionTable(m);
  let entry = 0;
  for (;;) {
    entry = $mapNext(m, table, entry);
    if (entry < 0) return;
    table = $collectionTable(m);
    $call<unknown>(f, thisArg, $mapValueAt<V>(m, entry), $mapKeyAt<K>(m, entry), m);
    entry++;
  }
}

export function Set$construct<T>(items: unknown): Set<T> {
  const isOriginal: boolean = $isOriginalArray(items);
  if (!isOriginal) return new (Set as any)(items, undefined);
  const array = items as T[];
  const set = new Set<T>();
  for (let k = 0; k < array.length; k++) set.add(array[k]);
  return set;
}

export function Set$forEach<T>(s: Set<T>, f: unknown, thisArg: unknown): void {
  if (typeof f !== "function") throw new TypeError("Set.prototype.forEach callback must be a function");
  let table = $collectionTable(s);
  let entry = 0;
  for (;;) {
    entry = $setNext(s, table, entry);
    if (entry < 0) return;
    table = $collectionTable(s);
    const key = $setKeyAt<T>(s, entry);
    $call<unknown>(f, thisArg, key, key, s);
    entry++;
  }
}
