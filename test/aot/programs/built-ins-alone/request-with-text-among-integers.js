const first = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
const result = new Request(first, "text");
console.log(result instanceof Request, Object.keys(result).join());
