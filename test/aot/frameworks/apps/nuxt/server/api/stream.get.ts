export default defineEventHandler(event => {
  const encoder = new TextEncoder();
  let sent = 0;
  setResponseHeader(event, "content-type", "text/plain");
  setResponseHeader(event, "x-made-by", "a stream");
  return new ReadableStream({
    async pull(controller) {
      if (sent === 3) return controller.close();
      await new Promise(resolve => setTimeout(resolve, 2));
      controller.enqueue(encoder.encode("chunk " + ++sent + "\n"));
    },
  });
});
