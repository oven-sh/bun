const registry = { k0: 0, k1: 1, k2: 2, k3: 3, k4: 4, k5: 5, k6: 6, k7: 7, k8: 8, k9: 9, k10: 10, k11: 11, k12: 12, k13: 13 } as const;
function builders<Types extends Record<string, any>>(options: Types): { [K in keyof Types]: () => Types[K] } {
  return Object.fromEntries(Object.entries(options).map(([key, value]) => [key, () => value])) as any;
}
const all = { ...builders(registry) };
console.log(Object.keys(all).length, all.k0(), all.k13());
