console.log(new Response("a").body.getReader());
console.log(new ReadableStream({ type: "bytes" }).getReader({ mode: "byob" }));
