const subject = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
const result = subject.blob();
const settled = await result;
console.log(settled instanceof Blob, Object.keys(settled).join(), subject instanceof Request, Object.keys(subject).join());
