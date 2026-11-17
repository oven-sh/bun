import { drainMicrotasks } from "bun:jsc";
see("first begins");
outsideOfStores(() => {
  see("first outside of stores");
  globalThis.withoutFile = import("data:text/javascript," + encodeURIComponent('see("module without a file");'));
  globalThis.withFile = import("./with-file.mjs");
});
drainMicrotasks();
see("first behind the drain");
