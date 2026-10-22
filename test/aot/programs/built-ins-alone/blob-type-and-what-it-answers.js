const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
const result = subject.type;
console.log(typeof result, result.length, result);
