import { drainMicrotasks } from "bun:jsc";
see("second begins");
const text = 'see("second without a store");';
outsideOfStores(() => {
  globalThis.secondWithoutStore = import("data:text/javascript," + encodeURIComponent(text));
});
globalThis.secondWithFile = import("./with-file-2.mjs");
drainMicrotasks();
see("second behind the drain");
