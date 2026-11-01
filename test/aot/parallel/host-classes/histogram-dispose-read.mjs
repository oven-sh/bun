// Alone: whether the method is compiled depends on what else the executable holds. A direct call of it would keep it
import { monitorEventLoopDelay } from "node:perf_hooks";
const ways = {
  readThenCalled() { const h = monitorEventLoopDelay(); h.enable(); const dispose = h[Symbol.dispose]; dispose.call(h); return h.disable(); },
  byAPattern() { const h = monitorEventLoopDelay(); h.enable(); const { [Symbol.dispose]: dispose } = h; dispose.call(h); return h.disable(); },
  byReflect() { const h = monitorEventLoopDelay(); h.enable(); Reflect.get(h, Symbol.dispose).call(h); return h.disable(); },
  offThePrototype() { const h = monitorEventLoopDelay(); h.enable(); Reflect.get(Object.getPrototypeOf(h), Symbol.dispose).call(h); return h.disable(); },
  bound() { const h = monitorEventLoopDelay(); h.enable(); h[Symbol.dispose].bind(h)(); return h.disable(); },
};
for (const [name, way] of Object.entries(ways)) console.log(name, way());
