const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
const result = subject.size;
console.log(typeof result, result + 1);
