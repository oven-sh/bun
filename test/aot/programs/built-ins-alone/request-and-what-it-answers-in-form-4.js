const first = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
const second = new Response("[1.5]", { status: 201, headers: { first: "1" } });
const result = new Request(first, second);
console.log(result instanceof Request, Object.keys(result).join());
