export const make = () => { const o: Record<string, unknown> = { a: 1 }; o.f = () => 1; o.b = 2; o.g = () => 2; o.c = 3; return o; };
export const lit = () => ({ f: () => 1, a: 1, g: () => 2, b: 2 });
