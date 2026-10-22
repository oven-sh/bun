const first = new ArrayBuffer(8, { maxByteLength: 16 });
const result = new Response(first, null);
console.log(result instanceof Response, Object.keys(result).join());
