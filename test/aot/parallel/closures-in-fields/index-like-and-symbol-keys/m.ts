export const t = Symbol("t");
export const make = () => ({ 0: () => "zero", "1": () => "one", [t]: () => "sym", "a-b": () => "dash", __proto__: null as any, n: 1 });
