const subject = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
const result = subject.arrayBuffer();
const settled = await result;
console.log(settled instanceof ArrayBuffer, settled.byteLength, subject instanceof Request, Object.keys(subject).join());
