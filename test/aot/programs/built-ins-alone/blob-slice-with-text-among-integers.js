const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
const result = subject.slice("text", "text", "text");
console.log(result instanceof Blob, Object.keys(result).join());
