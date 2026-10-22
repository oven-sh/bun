const subject = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
const result = subject.body;
console.log(result instanceof ReadableStream, Object.keys(result).join(), subject instanceof Request, Object.keys(subject).join());
