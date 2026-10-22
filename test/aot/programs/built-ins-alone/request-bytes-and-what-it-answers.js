const subject = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
const result = subject.bytes();
const settled = await result;
console.log(settled instanceof Uint8Array, settled.length, typeof settled[0], settled[0] + 1);
console.log(typeof settled[1], settled[1] + 1, subject instanceof Request, Object.keys(subject).join());
