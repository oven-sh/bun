// `[0 as any, ...typedArray]`: the elements keep their own functions.
declare const console: { log(...a: unknown[]): void };
const made = [0 as any, ...[1, 2].map(() => ({ m: () => 1 }))];
console.log(made[1].m === made[2].m);
