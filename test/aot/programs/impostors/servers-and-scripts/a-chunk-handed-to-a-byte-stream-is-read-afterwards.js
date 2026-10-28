const stream = new ReadableStream({
  type: "bytes",
  start(controller) {
    const view = new Uint8Array([1, 2, 3, 4, 5]);
    console.log("before", view.length, view.byteLength, view[0], view.buffer.byteLength);
    controller.enqueue(view);
    console.log("after", view.length, view.byteLength, view[0], view.buffer.byteLength);
    let sum = 0;
    for (let i = 0; i < view.length; i++) sum += view[i];
    console.log("sum", sum);
    controller.close();
  },
});
console.log((await stream.getReader().read()).value);
