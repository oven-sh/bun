// Exports of start-up modules: the store of an AsyncLocalStorage is kept by native code across timers, ticks, promises and events and comes back from getStore, whatever run and enterWith were given under `any`.
import { AsyncLocalStorage } from "node:async_hooks";

interface Request {
  id: number;
}

let total = 0;
const storage = new AsyncLocalStorage<Request>();

function weigh(): void {
  const store = storage.getStore();
  total += store === undefined ? 1 : typeof store === "string" ? 100 : typeof store.id === "number" ? store.id * 10000 : typeof store.id === "string" ? 1000000 : 100000000;
}

weigh();
storage.run({ id: 1 }, weigh);
storage.run({ id: 2 }, () => setTimeout(weigh, 1));
storage.run("text" as any, () => process.nextTick(weigh));
storage.run({ id: "3" } as any, () => Promise.resolve().then(weigh));
storage.run(JSON.parse('{"id":"4"}'), () => queueMicrotask(weigh));
storage.run({ id: 5 }, () => storage.exit(weigh));
storage.run({ id: 6 }, (a: number, b: number) => void (total += typeof a === "string" ? 1000000000 : 0), "a" as any, 2);
setTimeout(() => console.log(total), 10);
