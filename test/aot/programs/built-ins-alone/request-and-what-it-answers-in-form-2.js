const first = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
const result = new Request(first, null);
console.log(result instanceof Request, Object.keys(result).join());
