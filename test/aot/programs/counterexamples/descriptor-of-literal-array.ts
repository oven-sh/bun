// `Object.getOwnPropertyDescriptor(array, 0)?.value.m` reads the function of that element.
declare const console: { log(...a: unknown[]): void };
const made = [1, 2].map(() => ({ m: () => 1 }));
console.log(Object.getOwnPropertyDescriptor(made, 0)?.value.m === Object.getOwnPropertyDescriptor(made, 1)?.value.m);
