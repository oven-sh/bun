const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
const result = subject.arrayBuffer();
const settled = await result;
console.log(settled instanceof ArrayBuffer, settled.byteLength);
