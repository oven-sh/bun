const stream = new ReadableStream({
  type: "bytes",
  start(controller) {
    controller.enqueue(new Uint8Array([1, 2, 3]));
    controller.enqueue(new DataView(new ArrayBuffer(2)));
    let text = "no refusal";
    try {
      controller.enqueue("made up");
    } catch (error) {
      text = `${error}`;
    }
    console.log(`${text}`);
    controller.close();
  },
});
console.log(`${(await stream.bytes()).length}`);
const failing = new ReadableStream({ start(controller) { controller.error(new Error("made up")); } });
try {
  await failing.text();
} catch (error) {
  console.log(`${error.message}`);
}
