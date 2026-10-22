const controller = new AbortController();
const { signal } = controller;
console.log(signal.aborted, signal.reason === undefined);
controller.abort("stop");
console.log(signal.aborted, signal.reason);
