const first = new ArrayBuffer(0);
const result = new Response(first, null);
console.log(result instanceof Response, Object.keys(result).join());
