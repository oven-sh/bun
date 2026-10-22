const subject = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
const result = subject.bodyUsed;
console.log(typeof result, result);
