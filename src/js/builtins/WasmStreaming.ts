export async function consumeStream(this: any, stream: ReadableStream) {
  // NOTE: We're not using this.cancel()...where should that be used?
  try {
    $debug("WASM STREAMING: I got here!"); // REMOVE ME
    for await (const chunk of stream) {
      $debug("WASM STREAMING: got a chunk!"); // REMOVE ME
      this.addBytes(chunk);
    }
  } catch (error) {
    $debug("WASM STREAMING: uh oh!"); // REMOVE ME
    this.fail(error);
    return;
  }

  $debug("WASM STREAMING: hey, I finished!"); // REMOVE ME
  this.finalize();
}
