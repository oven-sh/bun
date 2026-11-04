try {
  AbortSignal.abort(new ReadableStream()).throwIfAborted();
} catch (error) {
  console.error(error);
}
