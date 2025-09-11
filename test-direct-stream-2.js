// Test direct stream without server
console.log("Creating direct stream");
const stream = new ReadableStream({
  type: 'direct',
  pull(controller) {
    console.log("Pull called, writing 'Hello'");
    controller.write('Hello');
    console.log("Closing controller");
    controller.close();
  },
  cancel(reason) {
    console.log('Cancel called with reason:', reason);
  },
});

console.log("Creating Response with stream");
const response = new Response(stream, {
  headers: { 'Content-Type': 'text/plain' },
});

console.log("Getting text from response");
const text = await response.text();
console.log("Got text:", JSON.stringify(text));