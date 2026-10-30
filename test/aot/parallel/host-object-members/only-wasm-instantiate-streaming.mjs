// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const bytes = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0, 7, 5, 1, 1, 102, 0, 0, 10, 6, 1, 4, 0, 65, 42, 11,
]);
const body = new ReadableStream({
  start(controller) {
    controller.enqueue(bytes.slice(0, 10));
    controller.enqueue(bytes.slice(10));
    controller.close();
  },
});
const { instance } = await WebAssembly.instantiateStreaming(
  new Response(body, { headers: { "content-type": "application/wasm" } }),
);
console.log(typeof instance.exports.f);
