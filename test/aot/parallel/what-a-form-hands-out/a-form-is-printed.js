// The printer prints a FormData by code of its own.
const form = await new Response("a=1&b=2", {
  headers: { "content-type": "application/x-www-form-urlencoded" },
}).formData();
console.log(form);
console.log(Bun.inspect(form));
console.log(JSON.stringify(form));
