export async function consumeStream(this: any, stream: ReadableStream) {
  // NOTE: We're not using this.cancel()...where should that be used?
  try {
    $debug("I got here!"); // REMOVE ME
    for await (const chunk of stream) this.addBytes(chunk);
  } catch (error) {
    $debug("uh oh!"); // REMOVE ME
    this.fail(error);
    return;
  }

  $debug("hey, I finished!"); // REMOVE ME
  this.finalize();
}
