let made = 0;
function assemble() {
  made++;
  globalThis.made = made;
  return { count: made };
}
Object.defineProperty(module, "exports", { enumerable: true, get: assemble });
