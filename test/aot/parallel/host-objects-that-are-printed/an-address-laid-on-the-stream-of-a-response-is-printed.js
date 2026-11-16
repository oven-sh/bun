// One question: built alone, it prints as plain Bun does.
const response = new Response(new ReadableStream({ start() {} })); response.body.place = new URL("http://made.up/a"); console.log(response);
