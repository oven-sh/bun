// Flags: --aot-validate
const worker = new Worker("./far.mjs");
const it = new Uint8Array([1, 2, 3, 4]).buffer;
const before = it.byteLength;
worker.postMessage(it, [it]);
console.log(before, it.byteLength, it.detached);
worker.onmessage = event => { console.log(event.data); worker.terminate(); };
