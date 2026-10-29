see("waits before its await");
setImmediate(() => {
  requireUnderStore();
  see("behind run()");
  setImmediate(() => second.resolve());
});
await first.promise;
see("waits behind its await");
export {};
