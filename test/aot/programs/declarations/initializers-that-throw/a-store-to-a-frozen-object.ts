function fill(into: { a: number }): { a: number } { into.a = 2; return into; }
export const made = fill(Object.freeze({ a: 1 }));
