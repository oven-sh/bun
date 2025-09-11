// Debug test to understand the order of operations
const server = Bun.serve({
  port: 0,
  fetch(request) {
    console.log("1. Creating direct stream");
    const stream = new ReadableStream({
      type: 'direct',
      pull(controller) {
        console.log("2. Pull called");
        controller.write('Hello');
        console.log("3. About to call controller.close()");
        controller.close();
        console.log("4. After controller.close()");
      },
      cancel(reason) {
        console.log('5. Cancel called with reason:', reason);
        console.trace();
      },
    });

    console.log("6. Returning Response with stream");
    return new Response(stream, {
      headers: { 'Content-Type': 'text/plain' },
    });
  },
});

console.log(`Server running on port ${server.port}`);

// Make a request
const response = await fetch(`http://localhost:${server.port}/`);
console.log("7. Got response");
const text = await response.text();
console.log("8. Got text:", JSON.stringify(text));

server.stop();