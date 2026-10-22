function noop() { return "info"; }
const proto = { info: noop };
globalThis.count = 0;
Object.defineProperty(module, "exports", {
  get() {
    count++;
    return Object.create(proto);
  },
});
