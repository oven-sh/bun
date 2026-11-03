Error.stackTraceLimit = 0;
console.log(new Error("x", { cause: { stream: new ReadableStream() } }));
