const subject = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
const result = subject.text();
const settled = await result;
console.log(typeof settled, settled.length, settled, subject instanceof Request, Object.keys(subject).join());
