const subject = new Blob([]);
const result = subject.stream(1.5);
console.log(result instanceof ReadableStream, Object.keys(result).join());
