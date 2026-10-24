// Stores to the exported variable of a TypeScript `namespace`, which are allowed, unlike stores to an imported binding.
declare const console: { log(...all: unknown[]): void };
namespace N { export let x = 1; export const read = () => x; }
N.x = 2; console.log(N.x, N.read());
[N.x] = [3]; console.log(N.x, N.read());
N.x += 4; console.log(N.x, N.read());
N.x++; console.log(N.x, N.read());
for (N.x of [9]) ; console.log(N.x, N.read());
