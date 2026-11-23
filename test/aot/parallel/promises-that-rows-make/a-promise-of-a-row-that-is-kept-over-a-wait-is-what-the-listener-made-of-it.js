// Kept over a wait: the listener is handed the promise and lays a `then` of its own on it.
process.on("unhandledRejection", (reason, promise) => {
  console.log("handed to the listener");
  promise.constructor = undefined;
  promise.then = resolve => resolve({ answered: "by the listener" });
});
const held = new Response(new ReadableStream({ start(controller) { controller.error(new Error("made up")); } })).text();
await new Promise(resolve => setTimeout(resolve, 20));
const text = await held;
console.log(typeof text, text.answered);
