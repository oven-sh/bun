const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
const result = subject.slice("an", 2.5, 3.5);
console.log(result instanceof Blob, Object.keys(result).join());
