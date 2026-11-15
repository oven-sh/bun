declare const self: DedicatedWorkerGlobalScope;
self.onmessage = (event: MessageEvent<number>) => {
  self.postMessage(event.data * 2);
};
export {};
