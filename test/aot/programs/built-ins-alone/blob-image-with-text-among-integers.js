const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
const result = subject.image("text");
console.log(typeof result, Object.keys(result).join());
