class Source { start(controller) { controller.enqueue("a"); } pull(controller) { controller.enqueue("b"); controller.close(); } }
class Upper { transform(chunk, controller) { controller.enqueue(chunk.toUpperCase()); } flush(controller) { controller.enqueue("!"); } }
let all = ""; for await (const chunk of new ReadableStream(new Source()).pipeThrough(new TransformStream(new Upper()))) all += chunk; console.log(all);
