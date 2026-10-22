const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
const result = subject.stat();
console.log(typeof result, result === undefined);
