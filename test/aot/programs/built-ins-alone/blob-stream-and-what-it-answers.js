const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
const result = subject.stream(1.5);
console.log(result instanceof ReadableStream, Object.keys(result).join());
