export async function consumeStream(this: $Node.WasmStreamingCompiler, stream: ReadableStream<Uint8Array>) {
  // NOTE: We're not using this.cancel()...where should that be used?
  try {
    for await (const chunk of stream) this.addBytes(chunk);
  } catch (error) {
    this.fail(error);
    return;
  }

  this.finalize();
}
