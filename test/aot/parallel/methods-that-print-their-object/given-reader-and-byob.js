// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
console.log(new Response("a").body.getReader());
console.log(new ReadableStream({ type: "bytes" }).getReader({ mode: "byob" }));
