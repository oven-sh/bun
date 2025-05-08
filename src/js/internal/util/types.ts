function mirrorObject<K extends PropertyKey, V extends PropertyKey>(object: Record<K, V>): Record<V, K> {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [value, key]));
}

export default { mirrorObject };
