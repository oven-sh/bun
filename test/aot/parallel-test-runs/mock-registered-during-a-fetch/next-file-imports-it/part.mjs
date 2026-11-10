globalThis.evaluations = (globalThis.evaluations ?? 0) + 1;
await new Promise(resolve => {
  globalThis.finishPart = resolve;
});
export const name = "real";
