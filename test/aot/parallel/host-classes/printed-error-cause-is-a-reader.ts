Error.stackTraceLimit = 0;
console.log(new Error("x", { cause: new ReadableStream().getReader() }));
