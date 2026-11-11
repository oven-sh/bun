// The wait stands right behind the call: somebody waits before the job ends, and no listener is handed the promise.
process.on("unhandledRejection", (reason, promise) => {
  console.log("handed to the listener");
  promise.constructor = undefined;
  promise.then = resolve => resolve("by the listener");
});
try {
  console.log(await new Response(new ReadableStream({ start(controller) { controller.error(new Error("made up")); } })).text());
} catch (error) {
  console.log(`caught ${error.message}`);
}
