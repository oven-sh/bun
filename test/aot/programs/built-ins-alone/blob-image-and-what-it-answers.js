const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
const result = subject.image(1.5);
console.log(typeof result, Object.keys(result).join());
