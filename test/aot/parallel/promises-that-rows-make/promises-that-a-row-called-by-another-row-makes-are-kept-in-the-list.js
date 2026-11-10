// The wait sees the list. The promises in it are kept over a wait.
process.on("unhandledRejection", (reason, promise) => {
  promise.constructor = undefined;
  promise.then = resolve => resolve({ answered: "by the listener" });
});
const streams = [new ReadableStream({ start(controller) { controller.error(new Error("made up")); } })];
const list = await streams.map(Bun.readableStreamToText);
await new Promise(resolve => setTimeout(resolve, 20));
const text = await list[0];
console.log(typeof text, text.answered);
