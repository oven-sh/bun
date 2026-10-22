const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
const result = subject.json();
const settled = await result;
console.log(Array.isArray(settled), settled.length, typeof settled[0], settled[0] + 1);
console.log(typeof settled[1], settled[1] + 1);
