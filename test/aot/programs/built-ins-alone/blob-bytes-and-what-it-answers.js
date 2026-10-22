const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
const result = subject.bytes();
const settled = await result;
console.log(settled instanceof Uint8Array, settled.length, typeof settled[0], settled[0] + 1);
console.log(typeof settled[1], settled[1] + 1);
