const subject = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
const result = subject.headers;
console.log(result instanceof Headers, Object.keys(result).join());
const items = [...result];
console.log(Array.isArray(items), items.length, Array.isArray(items[0]), items[0].length);
