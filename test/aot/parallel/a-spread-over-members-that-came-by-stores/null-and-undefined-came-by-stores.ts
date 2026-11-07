const o: Record<string, number | null | undefined> = {};
o.a = null; o.b = undefined;
console.log({ z: 1, ...o, a: 0.5 }.a);
export {};
