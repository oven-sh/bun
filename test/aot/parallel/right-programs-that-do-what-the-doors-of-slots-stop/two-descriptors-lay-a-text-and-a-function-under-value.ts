const first: any = { a: 1, k: undefined };
Object.defineProperty(first, "k", { value: "text", writable: true, enumerable: true, configurable: true });
const second: any = { a: 1, m: null };
Object.defineProperty(second, "m", { value: () => 1, writable: true, enumerable: true, configurable: true });
console.log(typeof first.k, typeof second.m);
