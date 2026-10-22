const subject = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
const result = subject.json();
const settled = await result;
console.log(Array.isArray(settled), settled.length, typeof settled[0], settled[0] + 1, subject instanceof Request);
console.log(Object.keys(subject).join());
