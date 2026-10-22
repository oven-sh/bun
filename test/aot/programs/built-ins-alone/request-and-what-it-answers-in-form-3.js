const first = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
const second = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
const result = new Request(first, second);
console.log(result instanceof Request, Object.keys(result).join());
