const first = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("[1.5]"));
    controller.close();
  },
});
const result = new Response(first, null);
console.log(result instanceof Response, Object.keys(result).join());
