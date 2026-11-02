Error.stackTraceLimit = 0;
console.log(new AggregateError([new Error("a"), new TypeError("b", { cause: new ReadableStream() })], "many"));
