import { EventEmitter, on } from "node:events";
const above = Object.getPrototypeOf(Object.getPrototypeOf(async function* () {}).prototype);
const first = on(new EventEmitter(), "made-up");
const second = on(new EventEmitter(), "made-up");
console.log(Object.getPrototypeOf(first) === above, Object.getPrototypeOf(second) === above, first[Symbol.asyncIterator]() === first);
await first.return();
await second.return();
