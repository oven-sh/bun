// Assorted: bound calls. It prints what plain Bun prints.
import { AsyncResource, AsyncLocalStorage } from "node:async_hooks";
const storage = new AsyncLocalStorage<number>();
function add(this: unknown, a: number, b: number) { return a + b + (storage.getStore() ?? 0); }
const bound = storage.run(5, () => AsyncResource.bind(add));
let sum = 0;
const rounds = Number(process.argv[2] ?? 10000);
for (let i = 0; i < rounds; i++) sum += bound(i, 1);
console.log(sum);
