const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
const result = subject.text();
const settled = await result;
console.log(typeof settled, settled.length, settled);
