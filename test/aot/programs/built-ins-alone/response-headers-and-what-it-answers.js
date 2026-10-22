const subject = new Response("[1.5]", { status: 201, headers: { first: "1" } });
const result = subject.headers;
console.log(result instanceof Headers, Object.keys(result).join());
const items = [...result];
console.log(Array.isArray(items), items.length, Array.isArray(items[0]), items[0].length);
