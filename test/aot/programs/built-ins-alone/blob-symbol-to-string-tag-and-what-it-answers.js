const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
const result = subject[Symbol.toStringTag];
console.log(typeof result, result.length, result);
