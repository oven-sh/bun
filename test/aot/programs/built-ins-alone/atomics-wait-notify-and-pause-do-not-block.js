const view = new Int32Array(new SharedArrayBuffer(8));
console.log(Atomics.wait(view, 0, 1), Atomics.wait(view, 0, 0, 0), Atomics.notify(view, 0, 1) + 1, Atomics.pause() === undefined);
const waiting = Atomics.waitAsync(view, 0, 1);
console.log(waiting.async, waiting.value);
