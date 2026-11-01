function getOrInsert<K extends object, V>(map: WeakMap<K, V>, key: K, make: (key: K) => V): V;
function getOrInsert<K, V>(map: Map<K, V>, key: K, make: (key: K) => V): V;
function getOrInsert<K extends object, V>(map: Map<K, V> | WeakMap<K, V>, key: K, make: (key: K) => V): V {
  if (map.has(key)) return map.get(key) as V;
  return map.set(key, make(key)).get(key) as V;
}
console.log(getOrInsert(new Map<boolean, string>(), false, () => "made"));
