const subject = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
const result = subject.searchParams;
console.log(result instanceof URLSearchParams, Object.keys(result).join());
const items = [...result];
console.log(Array.isArray(items), items.length, Array.isArray(items[0]), items[0].length);
console.log(Array.isArray(items[1]), items[1].length);
