const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
const result = subject.name;
console.log(typeof result, result === undefined);
