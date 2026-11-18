import { drainMicrotasks } from "bun:jsc";
see("first begins");
const text = 'see("first without a store");';
outsideOfStores(() => {
  globalThis.firstWithoutStore = import("data:text/javascript," + encodeURIComponent(text));
  globalThis.firstWithFile = store.run("S2", () => import("./with-file-1.mjs"));
});
drainMicrotasks();
see("first behind the drain");
